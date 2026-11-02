/**
 * Escolha de 1 a 5 temporadas com botões. Substitui o <select>: no Windows a roda do mouse sobre um select com foco troca o valor
 * sem o usuário perceber (duas renovações foram gravadas com 5 temporadas assim).
 */
export function YearsPicker({ label, value, max = 5, onChange }: { label: string; value: number; max?: number; onChange: (years: number) => void }) {
  return (
    <div className="years-picker" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <div className="row">
        {[1, 2, 3, 4, 5].map((y) => (
          <button key={y} type="button" role="radio" aria-checked={value === y} className={value === y ? '' : 'secondary'} disabled={y > max}
            title={y > max ? `Não aceita mais de ${max} temporada(s)` : ''} onClick={() => onChange(y)}>{y}</button>
        ))}
      </div>
    </div>
  );
}
