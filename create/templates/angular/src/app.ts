import { Component, CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import './components/hello-counter.zb';
import './components/zubra-welcome.zb';
import './components/zubra-examples.zb';

// Angular uses the element directly: [count] sets the property, (countchange) listens. For
// forms, ZubraModel from @zubra/runtime/angular makes an element work with ngModel and formControl.
@Component({
  selector: 'app-root',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <main>
      <zubra-welcome heading="{{title}}" framework="Angular"></zubra-welcome>
      <section class="try">
        <hello-counter [count]="count()" (countchange)="count.set($any($event).detail)" label="Clicks"></hello-counter>
        <p>Angular sees <span id="seen">{{ count() }}</span></p>
      </section>
      <zubra-examples></zubra-examples>
    </main>
  `,
})
export class App {
  count = signal(0);
}
