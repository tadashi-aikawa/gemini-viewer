import {Component, Input, Output, ViewChild, OnChanges, SimpleChanges, EventEmitter} from '@angular/core';
import * as CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/merge/merge';


function scrollToCenter(cm) {
    const {line} = cm.getCursor();

    const top = cm.charCoords({line: line, ch: 0}, 'local').top;
    const halfWindowHeight = cm.getWrapperElement().offsetHeight / 2;
    cm.scrollTo(null, top - halfWindowHeight);
}

@Component({
    selector: 'app-merge-viewer',
    styleUrls: ['./merge-viewer.css'],
    template: `<div #view></div>`,
})
export class MergeViewerComponent implements OnChanges {

    @Input() config: CodeMirror.MergeView.MergeViewEditorConfiguration;
    @Input() height?: string;
    @Output() instance: CodeMirror.MergeView.MergeViewEditor;
    @Output() onClickJ = new EventEmitter<void>();
    @Output() onClickL = new EventEmitter<void>();

    @ViewChild('view') view;

    ngOnChanges(changes: SimpleChanges): void {
        const editorKeyBinding = {
            'K': cm => {
                cm.execCommand('goNextDiff');
                scrollToCenter(cm);
            },
            'I': cm => {
                cm.execCommand('goPrevDiff');
                scrollToCenter(cm);
            },
            'J': cm => this.onClickJ.emit(),
            'L': cm => this.onClickL.emit()
        };

        this.config = changes['config']['currentValue'];
        this.view.nativeElement.innerHTML = '';
        if (this.config) {
            this.instance = CodeMirror.MergeView(this.view.nativeElement, this.config);
            this.setHeight(this.height || '70vh');
            this.instance.editor().setOption('extraKeys', editorKeyBinding);
            this.instance.leftOriginal().setOption('extraKeys', editorKeyBinding);
            this.instance.leftOriginal().focus();
        }
    }

    private setHeight(height: string) {
        const instanceAny: any = this.instance;
        instanceAny.wrap.style.height = height;
        this.instance.editor().setSize(null, height);
        if (this.instance.leftOriginal()) {
            this.instance.leftOriginal().setSize(null, height);
        }
        if (this.instance.rightOriginal()) {
            this.instance.rightOriginal().setSize(null, height);
        }
    }
}
