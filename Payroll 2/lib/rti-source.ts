type RtiPeriod={id:number;periodNumber:number;periodEnd:string|null};
type RtiRun={payPeriodId:number};
type RtiStatutorySource={employeeId:number;startDate:string};

export function cumulativeRtiSources<
  TPeriod extends RtiPeriod,
  TRun extends RtiRun,
  TStatutorySource extends RtiStatutorySource,
>(
  type:string,
  currentPeriod:TPeriod,
  periods:TPeriod[],
  runs:TRun[],
  statutorySources:TStatutorySource[],
  employeeIds:Set<number>,
){
  const sourcePeriods=periods.filter(item=>item.periodNumber<=currentPeriod.periodNumber);
  const sourcePeriodIds=new Set(sourcePeriods.map(item=>item.id));
  return {
    periods:sourcePeriods,
    runs:runs.filter(run=>sourcePeriodIds.has(run.payPeriodId)),
    statutorySources:type==="EPS"
      ?statutorySources.filter(event=>currentPeriod.periodEnd!==null&&employeeIds.has(event.employeeId)&&event.startDate<=currentPeriod.periodEnd)
      :[],
  };
}
