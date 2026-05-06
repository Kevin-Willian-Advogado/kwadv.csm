import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'shortNumber',
  standalone: true
})
export class ShortNumberPipe implements PipeTransform {
  transform(value: number): string {
    // 1. Regra para Zero
    if (value == 0) return 'Nenhuma';
    
    // Proteção contra valores nulos ou inválidos
    if (value === null || isNaN(value)) return '0';

    // 2. Regra para números menores que 1000
    if (value < 1000) return value.toString();

    // 3. Regra para K, M, B...
    const suffixes = ['K', 'M', 'B', 'T'];
    const suffixIndex = Math.floor(Math.log10(value) / 3) - 1;
    const unit = Math.pow(10, (suffixIndex + 1) * 3);
    
    const shortValue = value / unit;

    // Se for redondo (ex: 1.0), mostra sem decimal. Se não, mostra uma casa.
    return shortValue % 1 === 0 
      ? shortValue.toFixed(0) + suffixes[suffixIndex] 
      : shortValue.toFixed(1) + suffixes[suffixIndex];
  }
}