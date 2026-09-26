export const DASHBOARD_FORMULAS = Object.freeze({
  'Total de leads': '=COUNTA(INDIRECT("Leads!A2:A"))',
  Qualificados: '=COUNTIF(INDIRECT("Leads!C2:C");"Qualificado")',
  Desqualificados: '=COUNTIF(INDIRECT("Leads!C2:C");"Desqualificado")',
  'Taxa de qualificação': '=IFERROR(COUNTIF(INDIRECT("Leads!C2:C");"Qualificado")/(COUNTIF(INDIRECT("Leads!C2:C");"Qualificado")+COUNTIF(INDIRECT("Leads!C2:C");"Desqualificado"));0)',
});

export const DERIVED_VIEW_FORMULAS = Object.freeze({
  Qualificados: '=IFERROR(QUERY(INDIRECT("Leads!A2:W");"select * where C = \'Qualificado\'";0);"")',
  Desqualificados: '=IFERROR(QUERY(INDIRECT("Leads!A2:W");"select * where C = \'Desqualificado\'";0);"")',
});

export const VIEW_FORMULA_COUNT = Object.keys(DASHBOARD_FORMULAS).length
  + Object.keys(DERIVED_VIEW_FORMULAS).length;
