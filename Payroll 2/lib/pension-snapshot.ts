export type FrozenPensionSnapshot=Record<string,unknown>&{
  schemaVersion:"payflow-pension-evidence-2"|"payflow-pension-evidence-backfill-1";
  schemeId:number;
  provider:string;
  schemeName:string;
  taxRelief:"net-pay"|"relief-at-source";
  contributionDueDay:number;
  payrollId:string;
  firstName:string;
  lastName:string;
};

export function parseFrozenPensionSnapshot(value:unknown):FrozenPensionSnapshot {
  let snapshot:Record<string,unknown>;
  try { snapshot=JSON.parse(String(value||"")); }
  catch { throw new Error("Finalised pension contribution has a malformed frozen evidence snapshot."); }
  const schema=String(snapshot?.schemaVersion||"");
  const modern=schema==="payflow-pension-evidence-2",legacy=schema==="payflow-pension-evidence-backfill-1";
  const dueDay=Number(snapshot?.contributionDueDay),schemeId=Number(snapshot?.schemeId);
  const contributionFields=["employeeDeduction","employeeTaxRelief","employeeGrossContribution"];
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||(!modern&&!legacy)||
    !Number.isInteger(schemeId)||schemeId<=0||!String(snapshot.provider||"").trim()||!String(snapshot.schemeName||"").trim()||
    !["net-pay","relief-at-source"].includes(String(snapshot.taxRelief||""))||
    !Number.isInteger(dueDay)||dueDay<1||dueDay>28||
    !String(snapshot.payrollId||"").trim()||!String(snapshot.firstName||"").trim()||!String(snapshot.lastName||"").trim()||
    modern&&contributionFields.some(field=>!Number.isFinite(Number(snapshot[field]))))
    throw new Error("Finalised pension contribution has incomplete or unsupported frozen evidence.");
  return snapshot as FrozenPensionSnapshot;
}

export function hasValidFrozenPensionSnapshot(value:unknown){
  try { parseFrozenPensionSnapshot(value); return true; } catch { return false; }
}
