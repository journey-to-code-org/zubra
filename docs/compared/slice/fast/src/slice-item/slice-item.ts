import { FASTElement, attr, observable } from '@microsoft/fast-element';
import { declarativeTemplate } from '@microsoft/fast-element/declarative.js';

/** One thing on the menu. `left` is how many are left, or -1 for no limit; the page sets it. */
export class SliceItem extends FASTElement {
  @attr item!: string;
  @attr name!: string;
  @attr unit!: string;
  @attr price!: string;
  @attr add!: string;
  @observable left!: number;
}

SliceItem.define({ name: 'slice-item', template: declarativeTemplate() });
