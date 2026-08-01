const basisSuffix=/(?:W1|M1|X)$/;

export function normalizePayeTaxCode(value:unknown){
  return String(value||"").trim().toUpperCase().replace(/\s+/g,"");
}

export function isRecognisedPayeTaxCode(value:unknown){
  const normalized=normalizePayeTaxCode(value);
  const core=normalized.replace(basisSuffix,"");
  if(!core||core==="SNT"||core==="CNT")return false;
  return /^(?:[SC]?\d{1,4}[LMNPTY]|[SC]?K\d{1,4}|[SC]?(?:BR|0T)|NT|(?:D[01]|CD[01]|SD[0-3]))$/.test(core);
}
