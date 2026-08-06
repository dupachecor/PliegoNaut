import { describe, it, expect } from 'vitest';
import { parseVortalDate, parseVortalBudget, mapGridRows } from '../services/vortalScraperService';

describe('parseVortalDate', () => {
  it('parsea formato es de VORTAL (M/d/yyyy h:mm tt)', () => {
    const d = parseVortalDate('8/05/2026 9:52 PM');
    expect(d).not.toBeNull();
    // 8/05/2026 9:52 PM en Bogotá (UTC-5) = 2026-08-06 02:52 UTC
    expect(d!.toISOString()).toBe('2026-08-06T02:52:00.000Z');
  });

  it('parsea con segundos', () => {
    const d = parseVortalDate('1/01/2026 12:00:00 AM');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('devuelve null para texto inválido', () => {
    expect(parseVortalDate('')).toBeNull();
    expect(parseVortalDate('sin fecha')).toBeNull();
  });
});

describe('parseVortalBudget', () => {
  it('parsea formato COP con puntos de miles', () => {
    expect(parseVortalBudget('$1.234.567')).toBe(1234567);
  });

  it('ignora símbolos de moneda y letras', () => {
    expect(parseVortalBudget('1.234.567 COP')).toBe(1234567);
    expect(parseVortalBudget('N/D')).toBe(0);
  });
});

describe('mapGridRows', () => {
  const raw = [
    {
      noticeUid: 'CO1.NTC.10281640',
      country: 'COLOMBIA',
      entity: 'INSTITUCION EDUCATIVA SIMON BOLIVAR',
      reference: '01-2026',
      description: 'RENOVACION AL DERECHO AL USO DEL SISTEMA DE GESTION ESCOLAR',
      phase: 'Presentación de oferta',
      publishDateText: '8/05/2026 9:52 PM',
      deadlineText: '8/15/2026 4:00 PM',
      budgetText: '$1.234.567',
      status: 'Publicado',
      url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10281640',
    },
    { noticeUid: '', entity: 'SIN UID', description: 'x', status: 'Publicado' },
  ];

  it('mapea filas válidas y descarta las sin noticeUID', () => {
    const rows = mapGridRows(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].noticeUid).toBe('CO1.NTC.10281640');
    expect(rows[0].entity).toBe('INSTITUCION EDUCATIVA SIMON BOLIVAR');
    expect(rows[0].budget).toBe(1234567);
    expect(rows[0].publishDate).not.toBeNull();
    expect(rows[0].deadlineDate).not.toBeNull();
    expect(rows[0].status).toBe('Publicado');
  });
});
