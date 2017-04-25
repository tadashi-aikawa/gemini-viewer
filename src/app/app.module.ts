import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpModule} from '@angular/http';
import {MaterialModule} from '@angular/material';
import {Ng2SmartTableModule} from 'ng2-smart-table';
import {LocalStorageModule} from 'angular-2-local-storage';
import {SelectModule} from 'ng-select';
import {HotkeyModule} from 'angular2-hotkeys';
import { Ng2HighchartsModule } from 'ng2-highcharts';

import 'hammerjs';

import {AppComponent} from './app.component';
import {
    DeleteConfirmDialogComponent,
    EditorDialogComponent,
    GeminiSummaryComponent,
    HoverComponent,
    StatusCodeComponent,
    StatusComponent
} from './gemini-summary/gemini-summary.component';
import {MergeViewerComponent} from './merge-viewer/merge-viewer.component';
import {CommonModule} from '@angular/common';
import {DetailDialogComponent} from './detail-dialog/detail-dialog.component';
import {EditorComponent} from './editor/editor.component';

@NgModule({
    declarations: [
        AppComponent,
        GeminiSummaryComponent,
        MergeViewerComponent,
        DetailDialogComponent,
        DeleteConfirmDialogComponent,
        EditorDialogComponent,
        EditorComponent,
        HoverComponent,
        StatusCodeComponent,
        StatusComponent
    ],
    imports: [
        BrowserModule,
        BrowserAnimationsModule,
        FormsModule,
        HttpModule,
        MaterialModule,
        Ng2SmartTableModule,
        SelectModule,
        CommonModule,
        Ng2HighchartsModule,
        HotkeyModule.forRoot({disableCheatSheet: true}),
        LocalStorageModule.withConfig({
            prefix: 'gemini-viewer',
            storageType: 'localStorage'
        })
    ],
    entryComponents: [
        DetailDialogComponent,
        EditorComponent,
        DeleteConfirmDialogComponent,
        EditorDialogComponent,
        HoverComponent,
        StatusCodeComponent,
        StatusComponent
    ],
    providers: [],
    bootstrap: [AppComponent]
})
export class AppModule {
}
