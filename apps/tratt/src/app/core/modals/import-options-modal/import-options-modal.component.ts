import { Component, OnInit } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { Converter } from '@tratt/annotation';
import { TrattFormGeneratorModule } from '@tratt/ngx-components';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-import-options-modal',
  templateUrl: './import-options-modal.component.html',
  styleUrls: ['./import-options-modal.component.scss'],
  imports: [TrattFormGeneratorModule, TranslocoPipe],
})
export class ImportOptionsModalComponent extends TrattModal implements OnInit {
  public static options: NgbModalOptions = {
    keyboard: false,
    backdrop: 'static',
    scrollable: true,
    size: 'lg',
  };

  converter?: Converter;
  schema: any = undefined;
  value: any = undefined;
  jsonText = '';

  constructor(
    public annotationStoreService: AnnotationStoreService,
    protected override activeModal: NgbActiveModal,
    private transloco: TranslocoService,
  ) {
    super('importOptionsModal', activeModal);
  }

  ngOnInit() {
    if (this.schema && this.converter) {
      // A toggleable option is on when its key is present in the value, so
      // seed the ones that start on; stored options (a value) are kept as is.
      const seed: Record<string, unknown> = {};
      const root = `converters.${this.converter.name}.options`;
      for (const key of Object.keys(this.schema.properties)) {
        const propertyDefinition = this.schema.properties[key];
        if (propertyDefinition.title) {
          propertyDefinition.title = this.translateOr(
            `${root}.${key}.title`,
            propertyDefinition.title,
          );
          propertyDefinition.description = this.translateOr(
            `${root}.${key}.description`,
            propertyDefinition.description,
          );
        }
        if (propertyDefinition.toggledByDefault) {
          seed[key] = propertyDefinition.default;
        }
      }
      this.value ??= seed;
    }
    this.jsonText = JSON.stringify(this.value);
  }

  private translateOr(key: string, fallback: string): string {
    const translated = this.transloco.translate(key);
    return translated === key ? fallback : translated;
  }

  public override close(action?: string) {
    return super.close({
      action,
      result: this.value,
    });
  }

  onJsonTextChange(json: string) {
    try {
      this.value = JSON.parse(json);
    } catch (e) {
      console.error(e);
    }
  }
}
