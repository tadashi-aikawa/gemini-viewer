import {ActivatedRoute} from '@angular/router';
import {
    Change,
    DynamoResult,
    DynamoRow,
    EditorConfig,
    IgnoreCase,
    PropertyDiffsByCognition,
    Report,
    Summary,
    Trial
} from '../../models/models';
import {AwsService} from '../../services/aws-service';
import {Component, ElementRef, Input, OnInit, Optional, ViewChild} from '@angular/core';
import {ObjectList} from 'aws-sdk/clients/s3';
import {LocalDataSource, ViewCell} from 'ng2-smart-table';
import {MdDialog, MdDialogRef, MdSidenav, MdSnackBar} from '@angular/material';
import * as fileSaver from 'file-saver';
import * as _ from 'lodash';
import {DetailDialogComponent} from '../detail-dialog/detail-dialog.component';
import CheckStatus, {CheckStatuses} from '../../constants/check-status';
import {SettingsService} from '../../services/settings-service';
import {createPropertyDiffs, toCheckedAlready} from '../../utils/diffs';

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
    @Input() value: string | number;
    @Input() rowData: any;

    ngOnInit(): void {
        const v = String(this.value);
        this.renderValue = v;
        this.status = v[0] === '5' ? 'server-error' :
            v[0] === '4' ? 'client-error' : 'success';
    }
}


@Component({
    template: `
        <span [title]="hoverValue">{{renderValue}}</span>
    `
})
export class HoverComponent implements ViewCell, OnInit {
    renderValue: string;
    hoverValue: string;
    @Input() value: string | number;
    @Input() rowData: any;

    ngOnInit(): void {
        this.renderValue = `${String(this.value).split('&').length} queries`;
        this.hoverValue = String(this.value);
    }
}

@Component({
    template: `
        <md-chip-list *ngFor="let v of this.value">
            <md-chip>{{this.v}}</md-chip>
        </md-chip-list>
    `
})
export class LabelsComponent {
    @Input() value: string[];
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
    @Input() value: string | number;
    @Input() rowData: any;

    ngOnInit(): void {
        const v = String(this.value);
        this.renderValue = v;
        this.kind = v === 'same' ? 'primary' :
            v === 'different' ? 'accent' :
                v === 'failure' ? 'warn' : '';
    }
}


const filterFunction = (v, q) =>
    q.split(' and ').every(x => {
        try {
            return x.startsWith('not ') ?
                (v ? !new RegExp(x.replace(/^not /, '')).test(v) : true) :
                new RegExp(x).test(v);
        } catch (e) {
            return false;
        }
    });

const arrayFilterFunction = (vs: any[], q) =>
    q.split(' and ').every(x => {
        try {
            return x.startsWith('not ') ?
                (vs.length > 0 ? !vs.every(v => new RegExp(x.replace(/^not /, '')).test(v)) : true) :
                vs.some(v => new RegExp(x).test(v));
        } catch (e) {
            return false;
        }
    });

const TABLE_SETTINGS = {
    columns: {
        seq: {title: 'Seq', filterFunction, width: '100px'},
        name: {title: 'Name', filterFunction},
        path: {title: 'Path', filterFunction},
        status: {
            title: 'Status',
            type: 'custom',
            renderComponent: StatusComponent,
            filterFunction,
            width: '100px'
        },
        queries: {
            title: 'Queries',
            type: 'custom',
            renderComponent: HoverComponent,
            filterFunction,
            width: '100px'
        },
        originQueries: {
            title: 'OriginQueries',
            type: 'custom',
            renderComponent: HoverComponent,
            filterFunction,
            width: '100px'
        },
        attention: {title: 'Attention', width: '200px'},
        checkedAlready: {
            title: 'CheckedAlready',
            type: 'custom',
            renderComponent: LabelsComponent,
            filterFunction: arrayFilterFunction,
            width: '600px'
        },
        ignored: {
            title: 'Ignored',
            type: 'custom',
            renderComponent: LabelsComponent,
            filterFunction: arrayFilterFunction,
            width: '600px'
        },
        oneByte: {title: '<- Byte', filterFunction, width: '100px'},
        otherByte: {title: 'Byte ->', filterFunction, width: '100px'},
        oneSec: {title: '<- Sec', filterFunction, width: '100px'},
        otherSec: {title: 'Sec ->', filterFunction, width: '100px'},
        oneStatus: {
            title: '<- Status',
            type: 'custom',
            renderComponent: StatusCodeComponent,
            filterFunction,
            width: '100px'
        },
        otherStatus: {
            title: 'Status ->',
            type: 'custom',
            renderComponent: StatusCodeComponent,
            filterFunction,
            width: '100px'
        },
        requestTime: {title: 'Request time', filterFunction}
    },
    actions: false
};


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
    attention: string;
    checkedAlready: string[];
    ignored: string[];
}

@Component({
    selector: 'app-summary',
    templateUrl: './summary.component.html',
    styleUrls: [
        './summary.css',
        '../../../../node_modules/hover.css/css/hover.css'
    ]
})
export class SummaryComponent implements OnInit {
    @ViewChild('sidenav') sideNav: MdSidenav;
    @ViewChild('keyWord') keyWord: ElementRef;
    word = '';

    searchingSummary: boolean;
    searchErrorMessage: string;
    rows: DynamoRow[];
    settings: any;
    errorMessages: string[];

    selectedValues: string[] = this.settingsService.selectedColumnNames ||
        Object.keys(TABLE_SETTINGS.columns);
    optionColumns: { value: string, label: string }[] = _.map(
        TABLE_SETTINGS.columns,
        (v, k) => ({value: k, label: v.title})
    );
    activeReport: Report;
    checkedAlready: IgnoreCase[];
    ignores: IgnoreCase[];
    loadingReportKey: string;
    tableSource = new LocalDataSource();

    // TODO: Update after `onFilterChanged` if implemented by ng2-smart-table
    filteredTrials: Trial[];

    // TODO: Remove this if jumeaux( < 0.9.0) become not be used
    failureKey: string;

    statuses: CheckStatus[] = CheckStatuses.values;
    toDisplay: (key: CheckStatus) => string = CheckStatuses.toDisplay;

    constructor(private service: AwsService,
                private _dialog: MdDialog,
                private route: ActivatedRoute,
                private settingsService: SettingsService,
                private snackBar: MdSnackBar) {
    }

    ngOnInit(): void {
        setTimeout(() => {
            this.sideNav.open().then(() => {
                setTimeout(() => this.keyWord.nativeElement.click(), 100);
            });
        }, 0);
        this.route.params.subscribe(ps => {
            if (ps.searchWord) {
                this.word = ps.searchWord;
                this.searchReport(ps.searchWord);
            }
            if (ps.hashKey) {
                this.showReport(ps.hashKey)
                    .then((r: Report) => {
                        this.filteredTrials = r.trials.map(x => Object.assign(new Trial(), x));
                        if (ps.seq) {
                            this.showDetail(ps.seq - 1);
                        }
                    });
            }
        });
    }

    onSearchReports(keyword: string) {
        this.searchReport(keyword);
    }

    searchReport(keyword: string): Promise<DynamoRow[]> {
        return new Promise((resolve, reject) => {
            this.searchErrorMessage = undefined;
            this.searchingSummary = true;

            this.service.findSummary(keyword)
                .then((r: DynamoResult) => {
                    this.searchingSummary = false;
                    this.rows = r.Items.sort(
                        (a, b) => b.begin_time > a.begin_time ? 1 : -1
                    );
                    resolve(this.rows);
                })
                .catch(err => {
                    this.searchingSummary = false;
                    this.searchErrorMessage = err;
                    reject(err);
                });
        });
    }

    onClickCard(row: DynamoRow, event) {
        this.showReport(row.hashkey);
        event.stopPropagation();
    }

    onClickRetryHash(retryHash: string, event) {
        this.showReport(retryHash);
        event.stopPropagation();
    }

    onSelectCheckStatus(key: string, event) {
        const row: DynamoRow = this.rows.find((r: DynamoRow) => r.hashkey === key);

        row.updatingErrorMessage = undefined;
        this.service.updateStatus(key, event.value)
            .catch(err => {
                row.updatingErrorMessage = err;
            });
    }

    // TODO: Remove this function if jumeaux( < 0.9.0) become not be used
    onClickConvertReport() {
        this.loadingReportKey = this.failureKey;
        this.errorMessages = undefined;
        this.service.convertReport(this.failureKey)
            .then(_ => {
                this.showReport(this.failureKey);
            })
            .catch(err => {
                this.snackBar.open(err, '[FAILURE] Convert');
            });
    }

    onSelectColumns(event) {
        this.updateColumnVisibility();
    }

    onUpdateTitle(title: Change<string>) {
        this.service.fetchReport(this.activeReport.key)
            .then((r: Report) => {
                if (r.title !== title.previous) {
                    return Promise.reject('Conflict?? Please reload and update again.');
                }

                this.activeReport.title = title.current;
                // TODO: rollback since abnormal
                return Promise.all([
                    this.service.updateSummaryTitle(this.activeReport.key, title.current),
                    this.service.updateReportTitle(this.activeReport.key, title.current)
                ]);
            })
            .then(_ => {
                this.rows.find((r: DynamoRow) => r.hashkey === this.activeReport.key).title = title.current;
                this.snackBar.open('', '[SUCCESS] Title updated', {duration: 2000});
            })
            .catch(err => {
                this.snackBar.open(err, '[FAILURE] Title updated');
            });
    }

    onUpdateDescription(description: Change<string>) {
        this.service.fetchReport(this.activeReport.key)
            .then((r: Report) => {
                if (r.description !== description.previous) {
                    return Promise.reject('Conflict?? Please reload and update again.');
                }

                this.activeReport.description = description.current;
                // TODO: rollback since abnormal
                return Promise.all([
                    this.service.updateSummaryDescription(this.activeReport.key, description.current),
                    this.service.updateReportDescription(this.activeReport.key, description.current)
                ]);
            })
            .then(_ => {
                this.rows.find((r: DynamoRow) => r.hashkey === this.activeReport.key).description = description.current;
                this.snackBar.open('', '[SUCCESS] Description updated', {duration: 3000});
            })
            .catch(err => {
                this.snackBar.open(err, '[FAILURE] Description updated');
            });
    }

    showReport(key: string, analysis = false): Promise<Report> {
        return new Promise<Report>((resolve, reject) => {
            this.loadingReportKey = key;
            this.errorMessages = undefined;
            this.service.fetchReport(key)
                .then((r: Report) => {
                    this.loadingReportKey = undefined;

                    this.checkedAlready = toCheckedAlready(this.settingsService.checkList);
                    this.ignores = r.ignores;

                    const toAttention = (t: Trial): string => {
                        if (!analysis) {
                            return '(・ω・)';
                        }
                        if ((!t.diff_keys) && t.status === 'different') {
                            return 'No diff keys!!';
                        }
                        if (t.propertyDiffsByCognition && !t.propertyDiffsByCognition.unknown.isEmpty()) {
                            return 'Appears unknown!!';
                        }
                        if (t.one.status_code >= 400 && t.other.status_code >= 400) {
                            return 'Both failure!!';
                        }
                        return '';
                    };

                    r.trials = _(r.trials)
                        .map(t => Object.assign(new Trial(), t, {
                            propertyDiffsByCognition: analysis ? createPropertyDiffs(t, this.ignores, this.checkedAlready) : undefined
                        }))
                        .map(t => Object.assign(new Trial(), t, {
                            attention: toAttention(t)
                        }))
                        .value();
                    this.activeReport = r;

                    this.updateColumnVisibility();
                    this.tableSource.load(
                        r.trials.map(t => {
                            const c = t.propertyDiffsByCognition;

                            return <RowData>{
                                trial: t,
                                seq: t.seq,
                                name: t.name,
                                path: t.path,
                                status: t.status,
                                queries: t.queryString,
                                originQueries: t.originQueryString,
                                oneByte: t.one.byte,
                                otherByte: t.other.byte,
                                oneSec: t.one.response_sec,
                                otherSec: t.other.response_sec,
                                oneStatus: t.one.status_code,
                                otherStatus: t.other.status_code,
                                requestTime: t.request_time,
                                attention: t.attention,
                                checkedAlready: analysis ?
                                    (c ? _(c.checkedAlready).reject(x => x.isEmpty()).map(x => x.title).value() : []) :
                                    ['(・ω・)'],
                                ignored: analysis ?
                                    (c ? _(c.ignored).reject(x => x.isEmpty()).map(x => x.title).value() : []) :
                                    ['(・ω・)'],
                            };
                        })
                    ).then(() => {
                        this.tableSource.getFilteredAndSorted()
                            .then((es: RowData[]) => this.filteredTrials = es.map(x => x.trial));
                        resolve(r);
                    });
                })
                .catch(err => {
                    // TODO: Remove this function if jumeaux( < 0.9.0) become not be used
                    this.failureKey = key;

                    this.loadingReportKey = undefined;
                    this.errorMessages = [err];
                    reject(err);
                });
        });
    }

    downloadReport(key: string, filtered: boolean, event) {
        const row: DynamoRow = this.rows.find((r: DynamoRow) => r.hashkey === key);

        row.downloading = true;
        this.errorMessages = undefined;
        this.service.fetchReport(key)
            .then((x: Report) => {
                row.downloading = false;
                const reportName = `${row.title}-${key.substring(0, 7)}.json`;

                return this.tableSource.getFilteredAndSorted().then((es: RowData[]) => {
                    const filteredSeqs: number[] = es.map(e => e.trial.seq);
                    const obj: object = !filtered ? x :
                        Object.assign({}, x, {
                            trials: x.trials.filter(t => _.includes(filteredSeqs, t.seq))
                        });

                    fileSaver.saveAs(new Blob([JSON.stringify(obj)]), reportName);
                });
            })
            .catch(err => {
                row.downloading = false;
                row.downloadErrorMessage = err;
            });

        event.stopPropagation();
    }

    downloadArchive(key: string, event) {
        const row: DynamoRow = this.rows.find((r: DynamoRow) => r.hashkey === key);

        row.downloading = true;
        this.errorMessages = undefined;
        this.service.fetchArchive(key)
            .then(({name, body}) => {
                row.downloading = false;
                fileSaver.saveAs(body, `${row.title}-${name}`);
            })
            .catch(err => {
                row.downloading = false;
                row.downloadErrorMessage = err;
            });

        event.stopPropagation();
    }

    removeDetail(key: string, event) {
        const dialogRef = this._dialog.open(DeleteConfirmDialogComponent);
        this.errorMessages = undefined;
        dialogRef.componentInstance.isLoading = true;

        const row: DynamoRow = this.rows.find((r: DynamoRow) => r.hashkey === key);

        this.service.fetchList(key)
            .then((oList: ObjectList) => {
                dialogRef.componentInstance.isLoading = false;
                dialogRef.componentInstance.keys = oList.map(x => x.Key);
                dialogRef.afterClosed().subscribe((s3KeysToRemove: string[]) => {
                    if (s3KeysToRemove) {
                        row.deleting = true;

                        this.service.removeTrials(s3KeysToRemove)
                            .then(p => this.service.removeSummary(key))
                            .then(() => {
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
                this.errorMessages = [err];
            });
        event.stopPropagation();
    }

    onSelectRow(event: any) {
        event.source.getFilteredAndSorted().then((es: RowData[]) => {
            this.filteredTrials = es.map(x => x.trial);
            this.showDetail(es.findIndex(e => e === event.data));
        });
    }

    afterChangeTab(index: number): void {
        if (index === 1 || index === 2) {
            this.tableSource.getFilteredAndSorted()
                .then((es: RowData[]) => this.filteredTrials = es.map(x => x.trial));
        }
    }

    showDetail(index: number) {
        const dialogRef = this._dialog.open(DetailDialogComponent, {
            width: '80vw',
            height: '97%',
            disableClose: true
        });
        dialogRef.componentInstance.reportKey = this.activeReport.key;
        dialogRef.componentInstance.reportTitle = this.activeReport.title;
        dialogRef.componentInstance.oneAccessPoint = this.activeReport.summary.one;
        dialogRef.componentInstance.otherAccessPoint = this.activeReport.summary.other;
        dialogRef.componentInstance.activeIndex = String(index);
        dialogRef.componentInstance.trials = this.filteredTrials;
        dialogRef.componentInstance.ignores = this.ignores;
    }

    showRequestsAsJson() {
        this.tableSource.getFilteredAndSorted().then((rs: RowData[]) => {
            const dialogRef = this._dialog.open(EditorDialogComponent, {
                width: '80vw',
                height: '97%'
            });
            dialogRef.componentInstance.mode = 'json';
            dialogRef.componentInstance.title = 'Requests which can used on jumeaux';
            dialogRef.componentInstance.value = JSON.stringify(
                rs.map((x: RowData) => ({
                    name: x.trial.name,
                    path: x.trial.path,
                    qs: x.trial.queries,
                    headers: x.trial.headers
                })),
                null,
                4
            );
        });
    }

    showSummaryAsJson() {
        const dialogRef = this._dialog.open(EditorDialogComponent, {
            width: '80vw',
            height: '97%'
        });
        dialogRef.componentInstance.mode = 'json';
        dialogRef.componentInstance.title = 'Summary';
        dialogRef.componentInstance.value = JSON.stringify(
            {
                version: this.activeReport.version,
                key: this.activeReport.key,
                title: this.activeReport.title,
                description: this.activeReport.description,
                summary: this.activeReport.summary,
                ignores: this.activeReport.ignores,
                addons: this.activeReport.addons,
                retry_hash: this.activeReport.retry_hash,
            },
            null,
            4
        );
    }

    createActiveReportLink() {
        return `${location.origin}${location.pathname}#/report/${this.activeReport.key}/${this.activeReport.key}`;
    }

    private updateColumnVisibility() {
        this.settingsService.selectedColumnNames = this.selectedValues;
        this.settings = Object.assign({}, TABLE_SETTINGS,
            {columns: _.pick(TABLE_SETTINGS.columns, this.selectedValues)}
        );
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
        <h2 md-dialog-title>{{title}}</h2>
        <app-editor #editor
                    [config]="editorConfig"
        >
        </app-editor>
    `,
})
export class EditorDialogComponent implements OnInit {
    @Input() mode: string;
    @Input() title: string;
    @Input() value: string;
    editorConfig: EditorConfig;

    ngOnInit(): void {
        this.editorConfig = {
            content: this.value,
            contentType: this.mode,
            readOnly: true,
            theme: 'vs-dark'
        };
    }
}
