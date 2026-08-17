import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject, input, output } from '@angular/core';

@Directive({
  selector: '[appContentDropZone]',
})
export class ContentDropZoneDirective implements OnInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  readonly appContentDropZone = input.required<number>();
  readonly contentDragEntered = output<number>();
  readonly contentDropped = output<{ event: DragEvent; index: number }>();

  private readonly handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };

  private readonly handleDragEnter = (event: DragEvent): void => {
    event.preventDefault();
    this.zone.run(() => this.contentDragEntered.emit(this.appContentDropZone()));
  };

  private readonly handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    this.zone.run(() =>
      this.contentDropped.emit({ event, index: this.appContentDropZone() }),
    );
  };

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      const element = this.element.nativeElement;
      element.addEventListener('dragover', this.handleDragOver);
      element.addEventListener('dragenter', this.handleDragEnter);
      element.addEventListener('drop', this.handleDrop);
    });
  }

  ngOnDestroy(): void {
    const element = this.element.nativeElement;
    element.removeEventListener('dragover', this.handleDragOver);
    element.removeEventListener('dragenter', this.handleDragEnter);
    element.removeEventListener('drop', this.handleDrop);
  }
}
