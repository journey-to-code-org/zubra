// A form-associated component (`form-associated`): the API native form controls have, the form
// lifecycle callbacks, and its value and reset when it has one two-way prop. Its module imports
// this (`forming: $form`), so a page whose components aren't form controls doesn't load it.
import { effect } from './effect.js';
import { untrack } from './element.js';

// Disabled (inside a disabled <fieldset>, say) before the element's setup registered its hooks.
// Chromium always calls formDisabledCallback after connectedCallback, so there this is never
// used (the browser tests confirm the behaviour without it); it guards engines that order the
// callbacks the other way, which the test suite can't currently exercise.
const disabledEarly = new WeakMap();

/** @internal What interface 4 output names as `forming` for a form-associated component. */
export const $form = {
  /** On the class, before it's defined: the API and the callbacks the browser looks up then. */
  define(Element, { internals, hooksOf, props }) {
    const api = {
      form: { get() { return internals(this).form; } },
      validity: { get() { return internals(this).validity; } },
      validationMessage: { get() { return internals(this).validationMessage; } },
      willValidate: { get() { return internals(this).willValidate; } },
      labels: { get() { return internals(this).labels; } },
      checkValidity: { value() { return internals(this).checkValidity(); } },
      reportValidity: { value() { return internals(this).reportValidity(); } },
      formResetCallback: { value() { for (const fn of hooksOf(this)?.formReset ?? []) fn(); } },
      formStateRestoreCallback: { value(state, mode) { for (const fn of hooksOf(this)?.formRestore ?? []) fn(state, mode); } },
      formDisabledCallback: {
        value(disabled) {
          disabledEarly.set(this, disabled);
          for (const fn of hooksOf(this)?.formDisabled ?? []) fn(disabled);
        },
      },
    };
    if (!('name' in props)) {
      api.name = {
        get() { return this.getAttribute('name'); },
        set(value) { this.setAttribute('name', value); },
      };
    }
    for (const [key, descriptor] of Object.entries(api)) {
      Object.defineProperty(Element.prototype, key, { ...descriptor, configurable: true });
    }
  },
  /**
   * Before rendering: the server's stand-in for this control's value, for submitting before
   * JavaScript (@zubra/server's injectShadowRoots), goes; the element's own form value takes over.
   */
  begin(element) {
    for (const child of element.querySelectorAll(':scope>input[data-zb-fallback]')) child.remove();
  },
  /**
   * After the script ran: a form control with one two-way prop submits that, and a form reset
   * restores it, unless the script says otherwise.
   */
  model(hooks, $p, props, internals) {
    const models = Object.keys(props).filter((name) => props[name].model);
    if (models.length !== 1) return;
    const [name] = models;
    if (!hooks.formValued) {
      effect(() => {
        const value = $p[name];
        internals.setFormValue(value == null || value === false || value === ''
          ? null
          : value === true ? 'on' : typeof value === 'object' ? JSON.stringify(value) : String(value));
      });
    }
    if (!hooks.formReset.length) {
      const initialValue = untrack(() => $p[name]);
      hooks.formReset.push(() => { $p[name] = initialValue; });
    }
  },
  /** Once rendered: disabled before the hooks existed. */
  end(element, hooks) {
    if (disabledEarly.get(element)) for (const fn of hooks.formDisabled) fn(true);
  },
};
