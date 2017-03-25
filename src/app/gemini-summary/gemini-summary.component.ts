import {DynamoResult, DynamoRow, Report, Trial} from './gemini-summary';
import {SummaryService} from './gemini-summary.service';
import {Component, Input, Optional, OnInit} from '@angular/core';
import {ObjectList} from 'aws-sdk/clients/s3';
import {LocalDataSource, ViewCell} from 'ng2-smart-table';
import * as CodeMirror from 'codemirror';
import {MdDialogRef, MdDialog, MdSnackBar} from '@angular/material';
import {AwsConfig} from '../models';
import * as JSZip from 'jszip';
import * as fileSaver from 'file-saver';

const filterFunction = (v, q) => q.split(' and ').every(x => v.includes(x));

interface RowData {
    trial: Trial;
    name: string;
    path: string;
    queries: Object;
    status: string;
    oneByte: number;
    otherByte: number;
    oneSec: number;
    otherSec: number;
    oneStatus: number;
    otherStatus: number;
    requestTime: string;
}

@Component({
    selector: 'app-gemini-summary',
    templateUrl: './gemini-summary.component.html',
    styleUrls: [
        './gemini-summary.css',
        '../../../node_modules/hover.css/css/hover.css'
    ],
    providers: [
        SummaryService
    ]
})
export class GeminiSummaryComponent {
    @Input() awsConfig: AwsConfig;

    searchingSummary: boolean;
    searchErrorMessage: string;
    rows: DynamoRow[];
    settings: any;
    errorMessage: string;

    activeReport: Report;
    loadingReportKey: string;
    tableSource = new LocalDataSource();

    constructor(private service: SummaryService, private _dialog: MdDialog, public snackBar: MdSnackBar) {
    }

    searchReport(keyWord: string) {
        this.searchErrorMessage = undefined;
        this.searchingSummary = true;

        this.service.searchReport(keyWord, this.awsConfig)
            .then((r: DynamoResult) => {
                this.searchingSummary = false;
                this.rows = r.Items.sort(
                    (a, b) => b.begin_time > a.begin_time ? 1 : -1
                );
            })
            .catch(err => {
                this.searchingSummary = false;
                this.searchErrorMessage = err;
            });
    }

    showReport(key: string) {
        this.loadingReportKey = key;
        this.service.fetchReport(`${key}/report.json`, this.awsConfig)
            .then((r: Report) => {
                this.loadingReportKey = undefined;

                this.activeReport = r;
                this.settings = {
                    columns: {
                        name: {title: 'Name', filterFunction},
                        path: {title: 'Path', filterFunction},
                        status: {title: 'Status', type: 'custom', renderComponent: StatusComponent, filterFunction},
                        queries: {title: 'Queries', type: 'custom', renderComponent: HoverComponent, filterFunction},
                        oneByte: {title: '<- Byte'},
                        otherByte: {title: 'Byte ->'},
                        oneSec: {title: '<- Sec'},
                        otherSec: {title: 'Sec ->'},
                        oneStatus: {title: '<- Status', type: 'custom', renderComponent: StatusCodeComponent},
                        otherStatus: {title: 'Status ->', type: 'custom', renderComponent: StatusCodeComponent},
                        requestTime: {title: 'Request time'}
                    },
                    actions: false
                };
                this.tableSource.load(r.trials.map(t => (<RowData>{
                    trial: t,
                    name: t.name,
                    path: t.path,
                    status: t.status,
                    queries: Object.keys(t.queries).map(k => `${k}: ${t.queries[k]}`).join('&'),
                    oneByte: t.one.byte,
                    otherByte: t.other.byte,
                    oneSec: t.one.response_sec,
                    otherSec: t.other.response_sec,
                    oneStatus: t.one.status_code,
                    otherStatus: t.other.status_code,
                    requestTime: t.request_time
                })));
            })
            .catch(err => {
                this.loadingReportKey = undefined;
                this.errorMessage = err;
            });
    }

    downloadDetails(key: string, event) {
        /**
         * Fetch from S3 bucket
         * @param file
         * @return contents promise if file is not undefined else undefined promise
         */
        const fetchFile = (file: string): Promise<Object> =>
            file ?
                this.service.fetchDetail(`${key}/${file}`, this.awsConfig) :
                Promise.resolve(undefined);

        const fetchFiles = (files: string[]): Promise<Object[]> =>
            Promise.all(files.map(fetchFile));

        const row: DynamoRow = this.rows.find((r: DynamoRow) => r.hashkey === key);
        row.downloading = true;
        this.service.fetchReport(`${key}/report.json`, this.awsConfig)
            .then((r: Report) => {
                Promise.all([
                    fetchFiles(r.trials.map((x: Trial) => x.one.file)),
                    fetchFiles(r.trials.map((x: Trial) => x.other.file))
                ]).then((cs: Object[][]) => {
                    row.downloading = false;
                    const [ones, others] = cs;

                    const root = new JSZip().folder(key);
                    const one = root.folder('one');
                    const other = root.folder('other');

                    root.file('report.json', JSON.stringify(r, null, 4));
                    ones.forEach((c, i) => c && one.file(`${i + 1}-${r.trials[i].name}`, c));
                    others.forEach((c, i) => c && other.file(`${i + 1}-${r.trials[i].name}`, c));
                    root.generateAsync({type: 'blob'})
                        .then(x => fileSaver.saveAs(x, `${row.title}-${key.substring(0, 6)}.zip`));
                }).catch(err => {
                    row.downloading = false;
                    row.downloadErrorMessage = err;
                });
            })
            .catch(err => {
                row.downloading = false;
                row.downloadErrorMessage = err;
            });

        event.stopPropagation();
    }

    removeDetail(key: string, event) {
        const dialogRef = this._dialog.open(DeleteConfirmDialogComponent);
        dialogRef.componentInstance.isLoading = true;

        const row: DynamoRow = this.rows.find((r: DynamoRow) => r.hashkey === key);

        this.service.fetchList(key, this.awsConfig)
            .then((oList: ObjectList) => {
                dialogRef.componentInstance.isLoading = false;
                dialogRef.componentInstance.keys = oList.map(x => x.Key);
                dialogRef.afterClosed().subscribe((keysToRemove: string[]) => {
                    if (keysToRemove) {
                        row.deleting = true;

                        this.service.removeDetails(keysToRemove, this.awsConfig)
                            .then(p => this.service.removeReport(key, this.awsConfig))
                            .then(p => {
                                this.rows = this.rows.filter((r: DynamoRow) => r.hashkey !== key);
                                if (key === this.activeReport.key) {
                                    // TODO: abnormal
                                    this.showReport(this.rows[0].hashkey);
                                }
                            })
                            .catch(err => {
                                row.deleting = false;
                                row.deleteErrorMessage = err;
                            });
                    }
                });
            })
            .catch(err => {
                dialogRef.componentInstance.isLoading = false;
                this.errorMessage = err;
            });
        event.stopPropagation();
    }

    onSelectRow(data: RowData) {
        data.trial.one.file || data.trial.other.file ?
            this.showDetail(data) :
            this.snackBar.open('There are no stored responsies.', 'Close', {duration: 3000});
    }

    showDetail(data: RowData) {
        const fetchFile = (file: string) =>
            this.service.fetchDetail(`${this.activeReport.key}/${file}`, this.awsConfig);

        const dialogRef = this._dialog.open(DetailDialogComponent, {
            width: '80vw',
            height: '97%'
        });
        dialogRef.componentInstance.isLoading = true;
        dialogRef.componentInstance.title = `${data.name} (${data.path})`;
        dialogRef.componentInstance.trial = data.trial;

        // viewportMaring <==> search
        Promise.all([fetchFile(data.trial.one.file), fetchFile(data.trial.other.file)])
            .then((rs: string[]) => {
                dialogRef.componentInstance.isLoading = false;
                dialogRef.componentInstance.errorMessage = undefined;
                dialogRef.componentInstance.mergeViewConfig = {
                    value: rs[1],
                    orig: undefined,
                    origLeft: rs[0],
                    lineNumbers: true,
                    lineWrapping: true,
                    viewportMargin: 10,
                    collapseIdentical: 30,
                    readOnly: true
                };
            })
            .catch(err => {
                dialogRef.componentInstance.isLoading = false;
                dialogRef.componentInstance.errorMessage = err;
            });
    }

}

@Component({
    template: `
    <h2>{{title}}</h2>
    <div style="padding-bottom: 5px;">
        <span *ngFor="let q of displayedQueries" color="primary" selected="true">
            <md-chip color="primary" selected="true">
                {{q.key}}
            </md-chip>
            <small>{{q.value}}</small>
        </span>
    </div>
    <div class="smart-padding-without-top">
        <md-chip>Left</md-chip>
        <small>
            <a [href]="trial.one.url" class="ellipsis-text" style="width: 30vw" target="_blank">
                {{trial.one.url}}
            </a>
        </small>
        <md-chip>Right</md-chip>
        <small>
            <a [href]="trial.other.url" class="ellipsis-text" style="width: 30vw" target="_blank">
                {{trial.other.url}}
            </a>
        </small>
    </div>
    <div *ngIf="isLoading" class="center" style="height: 50vh;">
        <md-spinner style="width: 50vh; height: 50vh;"></md-spinner>
    </div>
    <div *ngIf="!isLoading">
        <app-merge-viewer [config]="mergeViewConfig"></app-merge-viewer>
    </div>
    <div *ngIf="errorMessage">
        {{errorMessage}}
    </div>
  `,
})
export class DetailDialogComponent implements OnInit {
    @Input() title: string;
    @Input() trial: Trial;
    @Input() isLoading: boolean;
    @Input() mergeViewConfig: CodeMirror.MergeView.MergeViewEditorConfiguration;
    @Input() errorMessage: string;

    displayedQueries: {key: string, value: string}[];

    constructor(@Optional() public dialogRef: MdDialogRef<DetailDialogComponent>) {
    }

    ngOnInit(): void {
        this.displayedQueries = Object.keys(this.trial.queries)
            .map(k => ({key: k, value: this.trial.queries[k].join(', ')}));
    }
}

@Component({
    template: `    
    <h2 md-dialog-title>Remove following items... is it really O.K.?</h2>

    <md-dialog-content>
        <div *ngIf="isLoading" class="center">
            <md-spinner></md-spinner>
        </div>
        <div *ngIf="!isLoading">
            <ul>
                <li *ngFor="let key of keys">{{key}}</li>
            </ul>
        </div>
    </md-dialog-content>
    
    <md-dialog-actions>
        <div class="smart-padding-without-bottom">
            <button md-raised-button
                    color="primary"
                    (click)="onClickRemove()">
                Remove
            </button>
            <button md-raised-button
                    color="secondary"
                    md-dialog-close>
                Cancel
            </button>
        </div>
    </md-dialog-actions>
  `,
})
export class DeleteConfirmDialogComponent {
    @Input() keys: string[];
    @Input() isLoading: boolean;

    constructor(@Optional() public dialogRef: MdDialogRef<DeleteConfirmDialogComponent>) {
    }

    onClickRemove() {
        this.dialogRef.close(this.keys);
    }
}

@Component({
    template: `
    <span [class]="status">{{renderValue}}</span>
    `,
    styles: [
        '.server-error { color: red; font-weight: bold;}',
        '.client-error { color: blue; font-weight: bold;}',
        '.success { color: green; }'
    ],
})
export class StatusCodeComponent implements ViewCell, OnInit {
    renderValue: string;
    status: string;
    @Input() value: string|number;

    ngOnInit(): void {
        const v = String(this.value);
        this.renderValue = v;
        this.status = v[0] === '5' ? 'server-error' :
            v[0] === '4' ? 'client-error' : 'success';
    }
}

@Component({
    template: `
    <span [mdTooltip]="hoverValue">{{renderValue}}</span>
    `
})
export class HoverComponent implements ViewCell, OnInit {
    renderValue: string;
    hoverValue: string;
    @Input() value: string|number;

    ngOnInit(): void {
        this.renderValue = `${String(this.value).split('&').length} queries`;
        this.hoverValue = String(this.value).split('&').join('\n');
    }
}

@Component({
    template: `
    <md-chip-list>
        <md-chip [color]="kind" selected="true">{{renderValue}}</md-chip>
    </md-chip-list>
    `
})
export class StatusComponent implements ViewCell, OnInit {
    renderValue: string;
    kind: string;
    @Input() value: string|number;

    ngOnInit(): void {
        const v = String(this.value);
        this.renderValue = v;
        this.kind = v === 'same' ? 'primary' :
            v === 'different' ? 'accent' :
                v === 'failure' ? 'warn' : '';
    }
}
