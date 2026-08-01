export type FrozenRtiSnapshot=Record<string,unknown>&{
  payrollId:string;
  firstName:string;
  lastName:string;
  taxCode:string;
  niCategory:string;
  reportedPayFrequency:"monthly"|"weekly"|"fortnightly"|"four-weekly";
  earningsPeriod:"monthly"|"weekly";
};

const supportedPayFrequencies=new Set(["monthly","weekly","fortnightly","four-weekly"]);

export function parseFrozenRtiSnapshot(value:unknown):FrozenRtiSnapshot {
  let snapshot:Record<string,unknown>;
  try {
    snapshot=JSON.parse(String(value||""));
  } catch {
    throw new Error("Finalised payroll has a malformed frozen RTI snapshot.");
  }
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||
    !String(snapshot.payrollId||"").trim()||!String(snapshot.firstName||"").trim()||!String(snapshot.lastName||"").trim()||
    !String(snapshot.taxCode||"").trim()||!String(snapshot.niCategory||"").trim()||
    !supportedPayFrequencies.has(String(snapshot.reportedPayFrequency||""))||
    !["monthly","weekly"].includes(String(snapshot.earningsPeriod||"")))
    throw new Error("Finalised payroll has an incomplete or unsupported frozen RTI snapshot.");
  return snapshot as FrozenRtiSnapshot;
}

export function hasValidFrozenRtiSnapshot(value:unknown){
  try { parseFrozenRtiSnapshot(value); return true; } catch { return false; }
}
