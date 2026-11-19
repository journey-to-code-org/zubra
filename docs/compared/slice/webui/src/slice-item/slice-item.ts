import { WebUIElement, attr, observable } from '@microsoft/webui-framework';

/** One thing on the menu. The page sets `left` from the live feed; the template does the rest. */
export class SliceItem extends WebUIElement {
  // No initial values: the server renders them, and a value set before hydration is a mismatch.
  @attr item!: string;
  @attr name!: string;
  @attr unit!: string;
  @attr price!: string;
  @attr add!: string;
  /** How many are left, or -1 for no limit. */
  @observable left!: number;
}

SliceItem.define('slice-item');
