import {
  AccessPoint,
  DiffViewConfig,
  EditorConfig,
  IgnoreCase,
  Pair,
  PropertyDiffs,
  PropertyDiffsByCognition,
  Trial,
} from '../../models/models';
import { animate, style, transition, trigger } from '@angular/animations';
import { AwsService } from '../../services/aws-service';
import { Component, Input, OnInit, Optional, ViewChild } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NgOption } from '@ng-select/ng-select';
import { Hotkey, HotkeysService } from 'angular2-hotkeys';
import * as _ from 'lodash';
import { Dictionary } from 'lodash';
import { Clipboard } from 'ts-clipboard';
import { SettingsService } from '../../services/settings-service';
import { createPropertyDiffs, toCheckedAlready, toLodashPath } from '../../utils/diffs';
import { ToasterService } from 'angular2-toaster';
import { matchRegExp } from '../../utils/regexp';
import { Memoize } from 'lodash-decorators';
import { regexpComparator } from '../../utils/filters';

const MAX_TAB_INDEX = 2;
const DIFF_VIEW_SKIP_TAG = 'hide_body';

interface KeyBindings {
  toggle_fullscreen: string;
  move_to_next_diff: string;
  move_to_previous_diff: string;
  show_next_trail: string;
  show_previous_trail: string;
  move_next_tab: string;
  move_previous_tab: string;
  copy_trial_url: string;
  copy_path: string;
  copy_one_url: string;
  copy_other_url: string;
  open_trial_list: string;
  close_this_dialog: string;
  open_cheat_sheet: string;
  close_cheat_sheet: string;
}

const KEY_BINDINGS_BY: Dictionary<KeyBindings> = {
  default: {
    toggle_fullscreen: 'f',
    move_to_next_diff: 'k',
    move_to_previous_diff: 'i',
    show_next_trail: 'l',
    show_previous_trail: 'j',
    move_next_tab: '>',
    move_previous_tab: '<',
    copy_trial_url: 'C',
    copy_path: 'P',
    copy_one_url: 'J',
    copy_other_url: 'L',
    open_trial_list: '/',
    close_this_dialog: 'w',
    open_cheat_sheet: '?',
    close_cheat_sheet: 'esc',
  },
  vim: {
    toggle_fullscreen: 'f',
    move_to_next_diff: 'j',
    move_to_previous_diff: 'k',
    show_next_trail: 'l',
    show_previous_trail: 'h',
    move_next_tab: '>',
    move_previous_tab: '<',
    copy_trial_url: 'Y',
    copy_path: 'P',
    copy_one_url: 'H',
    copy_other_url: 'L',
    open_trial_list: 'i',
    close_this_dialog: 'x',
    open_cheat_sheet: '?',
    close_cheat_sheet: 'esc',
  },
};

interface QueryRowData {
  key: string;
  value: string;
}

const applyIgnores = (
  contents: Pair<string>,
  languages: Pair<string>,
  ignoreDiffs: PropertyDiffs[],
  prefix: string,
): Pair<string> => {
  if (languages.one !== 'json' || languages.other !== 'json') {
    return { one: contents.one, other: contents.other };
  }

  const titleAndPaths = (f: Function): { title; path }[] =>
    _.flatMap(ignoreDiffs, (d: PropertyDiffs) =>
      f(d).map(p => ({
        title: d.title,
        path: toLodashPath(p),
      })),
    );

  const jsonOne = JSON.parse(contents.one);
  const jsonOther = JSON.parse(contents.other);

  titleAndPaths(x => x.added).forEach(x => {
    _.set(jsonOne, x.path, `<-- [${prefix}] (added) ${x.title} -->`);
    _.set(jsonOther, x.path, `<-- [${prefix}] (added) ${x.title} -->`);
  });
  titleAndPaths(x => x.changed).forEach(x => {
    _.set(jsonOne, x.path, `<-- [${prefix}] (changed) ${x.title} -->`);
    _.set(jsonOther, x.path, `<-- [${prefix}] (changed) ${x.title} -->`);
  });
  titleAndPaths(x => x.removed).forEach(x => {
    _.set(jsonOne, x.path, `<-- [${prefix}] (removed) ${x.title} -->`);
    _.set(jsonOther, x.path, `<-- [${prefix}] (removed) ${x.title} -->`);
  });

  const sortStringify = (obj): string =>
    JSON.stringify(
      obj,
      (none, v) =>
        !(v instanceof Array || v === null) && typeof v === 'object'
          ? Object.keys(v)
              .sort()
              .reduce((r, k) => {
                r[k] = v[k];
                return r;
              }, {})
          : v,
      4,
    );

  return {
    one: sortStringify(jsonOne),
    other: sortStringify(jsonOther),
  };
};

function createConfig(
  one: string,
  other: string,
  oneContentType: string,
  otherContentType: string,
  sideBySide: boolean,
): DiffViewConfig {
  return {
    leftContent: one,
    leftContentType: oneContentType,
    rightContent: other,
    rightContentType: otherContentType,
    readOnly: true,
    sideBySide: sideBySide,
    theme: 'vs',
  };
}

@Component({
  templateUrl: './detail-dialog.component.html',
  styleUrls: ['./detail-dialog.css', '../../../../node_modules/hover.css/css/hover.css'],
  animations: [
    trigger('diff-property-value', [
      transition(':enter', [style({ height: 0, opacity: 0 }), animate('150ms', style({ opacity: '*', height: '*' }))]),
      transition(':leave', [style({ opacity: '*' }), animate('150ms', style({ opacity: 0, height: 0 }))]),
    ]),
  ],
})
export class DetailDialogComponent implements OnInit {
  @Input() reportKey: string;
  @Input() reportTitle: string;
  @Input() oneAccessPoint: AccessPoint;
  @Input() otherAccessPoint: AccessPoint;
  @Input() trials: Trial[];
  @Input() ignores: IgnoreCase[] = [];
  @Input() checkedAlready: IgnoreCase[] = [];
  @Input() activeTabIndex = '0';
  @Input() cheatSheet = false;

  // Toggles
  @Input() fullscreen = false;
  @Input() unifiedDiff: boolean = this.settingsService.unifiedDiff;
  @Input() isIgnoredDiffHidden: boolean = this.settingsService.isIgnoredDiffHidden;
  @Input() isCheckedAlreadyDiffHidden: boolean = this.settingsService.isCheckedAlreadyDiffHidden;
  @Input() isLineFilterEnabled: boolean = this.settingsService.isLineFilterEnabled;
  @Input() isLineFilterNegative: boolean = this.settingsService.isLineFilterNegative;
  @Input() isResponseHeaderShown: boolean = this.settingsService.isResponseHeaderShown;

  @ViewChild('selector') selector;
  @ViewChild('diffView', { static: true }) diffView;
  @ViewChild('jsonParametersEditor') jsonParametersEditor;
  @ViewChild('rawEditor') rawEditor;
  @ViewChild('configEditor', { static: true }) configEditor;

  tableQueryRowData: QueryRowData[];
  tableFormParametersRowData: QueryRowData[];
  propertyDiffsByCognition: PropertyDiffsByCognition;
  expectedEncoding: Pair<string> = new Pair();

  activeIndex: string;
  originalEditorBody: Pair<string>;

  propertyObject: Pair<object>;
  targetProperty: string;
  targetPropertyValue: Pair<string>;

  editorLanguage: Pair<string>;
  options: NgOption[];
  isLoading: boolean;
  errorMessage: string;

  diffViewConfig: DiffViewConfig;
  jsonParametersEditorConfig: EditorConfig;
  rawEditorConfig: EditorConfig;
  editorConfig: EditorConfig;
  displayedQueries: { key: string; value: string }[];
  filteredWord: string;

  queryDefaultColDef = {
    filterParams: {
      textCustomComparator: regexpComparator,
      newRowsAction: 'keep',
      debounceMs: 200,
    },
    floatingFilterComponentParams: {
      debounceMs: 200,
    },
    sortable: true,
    resizable: true,
    filter: true,
  };

  queryColumnDefs = [
    {
      headerName: 'Key',
      field: 'key',
      width: 200,
      pinned: 'left',
    },
    {
      headerName: 'Value',
      field: 'value',
      width: 600,
    },
  ];

  get activeIndexNum(): number {
    return Number(this.activeIndex);
  }

  @Memoize((fullscreen, isLineFilterEnabled) => `${fullscreen}${isLineFilterEnabled}`)
  private calcDiffViewerHeight(fullscreen: boolean, isLineFilterEnabled: boolean): string {
    const heightBehindFullscreen = fullscreen ? 0 : 130;
    const heightBehindLineFilter = isLineFilterEnabled ? 50 : 0;
    const heightBehindResponseHeaderToggle = 20;
    return `calc(95vh - ${175 +
      heightBehindFullscreen +
      heightBehindLineFilter}px - ${heightBehindResponseHeaderToggle}px)`;
  }

  get diffViewerHeight(): string {
    return this.calcDiffViewerHeight(this.fullscreen, this.isLineFilterEnabled);
  }

  get trial(): Trial {
    return this.trials[this.activeIndex];
  }

  constructor(
    private service: AwsService,
    @Optional() public dialogRef: MatDialogRef<DetailDialogComponent>,
    private _hotkeysService: HotkeysService,
    private settingsService: SettingsService,
    public snackBar: MatSnackBar,
    private toasterService: ToasterService,
  ) {}

  ngOnInit(): void {
    const keyMode: KeyBindings = KEY_BINDINGS_BY[this.settingsService.keyMode];
    // XXX: _hotkeysService.remove(Hotkey[]) is not worked (maybe issues)
    this._hotkeysService.hotkeys.splice(0).forEach(x => this._hotkeysService.remove(x));

    this._hotkeysService.add([
      new Hotkey(
        keyMode.toggle_fullscreen,
        () => {
          this.changeFullscreen(!this.fullscreen);
          return false;
        },
        null,
        'Toggle fullscreen',
      ),
      new Hotkey(
        keyMode.move_to_next_diff,
        () => {
          this.diffView.moveToNextDiff();
          return false;
        },
        null,
        'Move to next diff.',
      ),
      new Hotkey(
        keyMode.move_to_previous_diff,
        () => {
          this.diffView.moveToPreviousDiff();
          return false;
        },
        null,
        'Move to previous diff.',
      ),
      new Hotkey(
        keyMode.show_next_trail,
        () => {
          this.showNextTrial();
          return false;
        },
        null,
        'Show next trial.',
      ),
      new Hotkey(
        keyMode.show_previous_trail,
        () => {
          this.showPreviousTrial();
          return false;
        },
        null,
        'Show previous trial.',
      ),
      new Hotkey(
        keyMode.move_next_tab,
        () => {
          this.moveToNextTab();
          return false;
        },
        null,
        'Move to next tab.',
      ),
      new Hotkey(
        keyMode.move_previous_tab,
        () => {
          this.moveToPreviousTab();
          return false;
        },
        null,
        'Move to previous tab.',
      ),
      new Hotkey(
        keyMode.copy_trial_url,
        () => {
          this.copyActiveTrialLink();
          return false;
        },
        null,
        'Copy trial url.',
      ),
      new Hotkey(
        keyMode.copy_path,
        () => {
          Clipboard.copy(this.trial.path);
          this.toasterService.pop('success', `Copied this trial path`, this.trial.path);
          return false;
        },
        null,
        'Copy path.',
      ),
      new Hotkey(
        keyMode.copy_one_url,
        () => {
          Clipboard.copy(this.trial.one.url);
          this.toasterService.pop('success', `Copied ${this.oneAccessPoint.name} url`, this.trial.one.url);
          return false;
        },
        null,
        'Copy one url.',
      ),
      new Hotkey(
        keyMode.copy_other_url,
        () => {
          Clipboard.copy(this.trial.other.url);
          this.toasterService.pop('success', `Copied ${this.otherAccessPoint.name} url`, this.trial.other.url);
          return false;
        },
        null,
        'Copy other url.',
      ),
      new Hotkey(
        keyMode.open_trial_list,
        () => {
          this.openSelector();
          return false;
        },
        null,
        'Open trial list',
      ),
      new Hotkey(
        keyMode.close_this_dialog,
        () => {
          this.closeDialog();
          return false;
        },
        null,
        'Close this dialog',
      ),
      new Hotkey(
        keyMode.open_cheat_sheet,
        () => {
          this.cheatSheet = true;
          return false;
        },
        null,
        'Open cheat sheet',
      ),
      new Hotkey(
        keyMode.close_cheat_sheet,
        () => {
          this.cheatSheet = false;
          return false;
        },
        null,
        'Close cheat sheet',
      ),
    ]);

    // FIXME
    this.editorConfig = {
      content: this.settingsService.checkList,
      contentType: 'yaml',
      readOnly: false,
      theme: 'vs',
      minimap: {
        enabled: false,
      },
    };

    this.checkedAlready = toCheckedAlready(this.editorConfig.content);

    // value is index of trial
    this.options = this.trials.map((t, i) => ({
      label: `${t.seq}. ${t.name} (${t.method} ${t.path})`,
      tags: t.tags,
      value: String(i),
    }));

    this.showTrial(this.trial);
  }

  closeDialog(): void {
    this.dialogRef.close();
  }

  showNextTrial(): boolean {
    if (this.activeIndexNum === this.trials.length - 1) {
      return false;
    }

    this.activeIndex = String(this.activeIndexNum + 1);
    this.showTrial(this.trials[this.activeIndexNum]);
  }

  showPreviousTrial(): boolean {
    if (this.activeIndexNum === 0) {
      return false;
    }

    this.activeIndex = String(this.activeIndexNum - 1);
    this.showTrial(this.trials[this.activeIndexNum]);
  }

  openSelector(): void {
    this.selector.open();
  }

  updateDiffEditorBodies(): void {
    const filtered = (body: string): string =>
      body
        .split('\n')
        .filter(x => this.isLineFilterNegative !== matchRegExp(x, this.filteredWord))
        .join('\n');

    // XXX: Avoid bugs what is both `Red eye` and `Response header` are checked.
    const bodyPair: Pair<string> = this.isResponseHeaderShown
      ? { one: this.originalEditorBody.one, other: this.originalEditorBody.other }
      : this.maskIgnores(this.originalEditorBody, this.editorLanguage);
    const needsFilter: boolean = this.isLineFilterEnabled && !!this.filteredWord;

    this.diffViewConfig = createConfig(
      needsFilter ? filtered(bodyPair.one) : bodyPair.one,
      needsFilter ? filtered(bodyPair.other) : bodyPair.other,
      this.editorLanguage.one,
      this.editorLanguage.other,
      !this.unifiedDiff,
    );
  }

  private showRejectMessageOnDiffViewer(message: string): void {
    this.errorMessage = undefined;
    // We must initialize diffView after set config.
    // Changing `this.isLoading` and sleep a bit time causes onInit event so I wrote ...
    setTimeout(() => {
      this.isLoading = false;
      this.targetPropertyValue = undefined;
      this.originalEditorBody = {
        one: message,
        other: message,
      };
      this.editorLanguage = { one: 'text', other: 'text' };
      this.expectedEncoding = { one: 'None', other: 'None' };
      this.updateDiffEditorBodies();
    }, 100);
  }

  showTrial(trial: Trial): void {
    // Diff viewer
    this.isLoading = true;

    if (this.isResponseHeaderShown) {
      this.errorMessage = undefined;
      // We must initialize diffView after set config.
      // Changing `this.isLoading` and sleep a bit time causes onInit event so I wrote ...
      setTimeout(() => {
        this.isLoading = false;
        this.targetPropertyValue = undefined;
        this.originalEditorBody = {
          one: JSON.stringify(trial.one.response_header, null, 4),
          other: JSON.stringify(trial.other.response_header, null, 4),
        };
        this.editorLanguage = { one: 'json', other: 'json' };
        this.expectedEncoding = { one: 'utf-8', other: 'utf-8' };
        this.updateDiffEditorBodies();
      }, 100);
    } else {
      if (trial.hasResponse()) {
        if (trial.one.type === 'octet-stream' || trial.other.type === 'octet-stream') {
          this.showRejectMessageOnDiffViewer('(^_^;) Binary is not supported to show');
        } else if (_.includes(trial.tags, DIFF_VIEW_SKIP_TAG)) {
          this.showRejectMessageOnDiffViewer(`(´Д｀) There is ${DIFF_VIEW_SKIP_TAG} tag so not to show body`);
        } else {
          const fetchFile = (file: string) => this.service.fetchFile(this.reportKey, file);

          this.errorMessage = undefined;
          Promise.all(
            _.compact([trial.one.file, trial.other.file, trial.one.prop_file, trial.other.prop_file]).map(x =>
              fetchFile(x),
            ),
          )
            .then((rs: { encoding: string; body: string }[]) => {
              this.isLoading = false;
              this.targetPropertyValue = undefined;

              this.originalEditorBody = { one: rs[0].body, other: rs[1].body };
              this.editorLanguage = {
                one: trial.one.type,
                other: trial.other.type,
              };
              this.expectedEncoding = { one: rs[0].encoding, other: rs[1].encoding };

              // has property json?
              if (rs.length === 4) {
                this.propertyObject = {
                  one: JSON.parse(rs[2].body),
                  other: JSON.parse(rs[3].body),
                };
              }

              this.updateDiffEditorBodies();
            })
            .catch(err => {
              this.isLoading = false;
              this.errorMessage = err;
            });
        }
      } else {
        this.errorMessage = undefined;
        // We must initialize diffView after set config.
        // Changing `this.isLoading` and sleep a bit time causes onInit event so I wrote ...
        setTimeout(() => {
          this.isLoading = false;
          this.targetPropertyValue = undefined;
          this.originalEditorBody = { one: 'No file', other: 'No file' };
          this.editorLanguage = { one: 'text', other: 'text' };
          this.expectedEncoding = { one: 'None', other: 'None' };
          this.updateDiffEditorBodies();
        }, 100);
      }
    }

    // Parameters
    this.displayedQueries = Object.keys(trial.queries).map(k => ({ key: k, value: trial.queries[k].join(', ') }));
    this.tableQueryRowData = this.displayedQueries.map(
      t =>
        <QueryRowData>{
          key: t.key,
          value: t.value,
        },
    );
    if (this.trial.form) {
      this.tableFormParametersRowData = Object.keys(this.trial.form).map(
        k =>
          <QueryRowData>{
            key: k,
            value: this.trial.form[k].join(', '),
          },
      );
    }
    if (this.trial.json) {
      this.jsonParametersEditorConfig = {
        content: JSON.stringify(this.trial.json, null, 4),
        contentType: 'json',
        readOnly: true,
      };
    }
    if (this.trial.raw) {
      this.rawEditorConfig = {
        content: this.trial.raw,
        contentType: 'raw',
        readOnly: false,
      };
    }

    // Property diffs
    this.propertyDiffsByCognition = createPropertyDiffs(trial, this.ignores, this.checkedAlready);
  }

  private maskIgnores(bodyPair: Pair<string>, languagePair: Pair<string>): Pair<string> {
    const bodyApplyIgnoredPair: Pair<string> =
      this.isIgnoredDiffHidden && this.propertyDiffsByCognition
        ? applyIgnores(bodyPair, languagePair, this.propertyDiffsByCognition.ignored, 'IGNORED')
        : { one: bodyPair.one, other: bodyPair.other };

    return this.isCheckedAlreadyDiffHidden && this.propertyDiffsByCognition
      ? applyIgnores(bodyApplyIgnoredPair, languagePair, this.propertyDiffsByCognition.checkedAlready, 'CHECKD_ALREADY')
      : { one: bodyApplyIgnoredPair.one, other: bodyApplyIgnoredPair.other };
  }

  moveToNextTab(): void {
    const dst = Number(this.activeTabIndex) + 1;
    this.activeTabIndex = String(dst > MAX_TAB_INDEX ? 0 : dst);
  }

  moveToPreviousTab(): void {
    const dst = Number(this.activeTabIndex) - 1;
    this.activeTabIndex = String(dst < 0 ? MAX_TAB_INDEX : dst);
  }

  changeFullscreen(fullscreen: boolean) {
    this.fullscreen = fullscreen;
  }

  changeFilteredWord() {
    this.updateDiffEditorBodies();
  }

  changeLineFilterNegative(isLineFilterNegative: boolean) {
    this.isLineFilterNegative = isLineFilterNegative;
    this.settingsService.isLineFilterNegative = isLineFilterNegative;
    this.updateDiffEditorBodies();
  }

  changeDiffType(unifiedDiff: boolean) {
    this.unifiedDiff = unifiedDiff;
    this.settingsService.unifiedDiff = unifiedDiff;
    this.updateDiffEditorBodies();
  }

  changeHideIgnoredDiff(hideIgnored: boolean) {
    this.isIgnoredDiffHidden = hideIgnored;
    this.settingsService.isIgnoredDiffHidden = hideIgnored;
    this.updateDiffEditorBodies();
  }

  changeHideCheckedAlreadyDiff(hideCheckedAlready: boolean) {
    this.isCheckedAlreadyDiffHidden = hideCheckedAlready;
    this.settingsService.isCheckedAlreadyDiffHidden = hideCheckedAlready;
    this.updateDiffEditorBodies();
  }

  changeLineFilterEnabled(enabled: boolean) {
    this.isLineFilterEnabled = enabled;
    this.settingsService.isLineFilterEnabled = enabled;
    this.updateDiffEditorBodies();
  }

  changeResponseHeaderShown(shown: boolean) {
    this.isResponseHeaderShown = shown;
    this.settingsService.isResponseHeaderShown = shown;
    this.showTrial(this.trial);
  }

  afterChangeTab(index: number): void {
    if (index === 0 && this.diffView) {
      this.diffView.updateView();
    }
    if (index === 1) {
      this.jsonParametersEditor?.updateView();
      this.rawEditor?.updateView();
    }
    if (index === 2 && this.configEditor) {
      this.configEditor.updateView();
    }
  }

  updateEditorConfig() {
    this.checkedAlready = toCheckedAlready(this.configEditor.getValue());
    this.settingsService.checkList = this.configEditor.getValue();
    this.propertyDiffsByCognition = createPropertyDiffs(this.trial, this.ignores, this.checkedAlready);
    this.updateDiffEditorBodies();
  }

  copyActiveTrialLink() {
    const path = `${location.pathname}#/report/${this.reportKey.slice(0, 7)}/${this.reportKey.slice(0, 7)}/${
      this.trial.seq
    }`;

    const query = [
      `region=${this.service.region}`,
      `table=${this.service.table}`,
      `bucket=${this.service.bucket}`,
      `prefix=${this.service.prefix}`,
    ].join('&');
    const url = `${location.origin}${path}?${query}`;

    Clipboard.copy(url);
    this.toasterService.pop('success', `Copied this trial url`, url);
  }

  private pickValue(propertyObject: object, property: string): string {
    return _.get(propertyObject, toLodashPath(property));
  }

  private getValue(property: string): Pair<string> | undefined {
    if (
      _.some([
        !this.originalEditorBody,
        !this.propertyObject.one,
        !this.propertyObject.other,
        this.isLoading,
        !property,
      ])
    ) {
      return undefined;
    }
    const one: string = this.pickValue(this.propertyObject.one, property);
    const other: string = this.pickValue(this.propertyObject.other, property);

    return { one: JSON.stringify(one), other: JSON.stringify(other) };
  }

  showTargetPropertyValue(property: string) {
    this.targetProperty = property === this.targetProperty ? undefined : property;
    this.targetPropertyValue = this.getValue(this.targetProperty);
  }

  judgeDiffColor(property: string): string {
    return this.targetPropertyValue && this.targetProperty === property ? 'red' : 'black';
  }
}
