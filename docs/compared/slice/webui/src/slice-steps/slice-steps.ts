import { WebUIElement, attr, observable } from '@microsoft/webui-framework';

/** Where an order is. The page sets `status` from the live feed; the template does the rest. */
export class SliceSteps extends WebUIElement {
  @attr order!: string;
  @observable status!: string;
}

SliceSteps.define('slice-steps');
