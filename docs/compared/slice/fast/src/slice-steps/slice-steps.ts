import { FASTElement, attr, observable } from '@microsoft/fast-element';
import { declarativeTemplate } from '@microsoft/fast-element/declarative.js';

/** Where an order is. The page sets `status` from the live feed; the template does the rest. */
export class SliceSteps extends FASTElement {
  @attr order!: string;
  @observable status!: string;
}

SliceSteps.define({ name: 'slice-steps', template: declarativeTemplate() });
