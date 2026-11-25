import { Pipe, PipeTransform } from '@angular/core';

/** Zero-pads `value` to the number of digits of `maxnum` (842 -> "001".."842"). */
@Pipe({
  name: 'leadingnull',
})
export class LeadingNullPipe implements PipeTransform {
  transform(value: any, maxnum: number): string {
    return String(value).padStart(String(Math.max(maxnum, 1)).length, '0');
  }
}
