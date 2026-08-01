import { payrollFrequencyRule, type PayrollFrequency } from "./pay-frequency.ts";

export type PensionAssessment = {
  category: "eligible-jobholder" | "non-eligible-jobholder" | "entitled-worker" | "outside-scope";
  action: "enrol" | "offer-opt-in" | "offer-join" | "none";
  qualifyingEarnings: number;
  employeeContribution: number;
  employerContribution: number;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const thresholds:Record<PayrollFrequency,{lower:number;trigger:number;upper:number}>={
  weekly:{lower:120,trigger:192,upper:967},
  fortnightly:{lower:240,trigger:384,upper:1934},
  "four-weekly":{lower:480,trigger:768,upper:3867},
  monthly:{lower:520,trigger:833,upper:4189},
};

export function assessPension(input: {
  age:number;
  monthlyEarnings?:number;
  earnings?:number;
  payFrequency?:PayrollFrequency;
  employeeRate?:number;
  employerRate?:number;
}): PensionAssessment {
  const { age } = input;
  const frequency=input.payFrequency||"monthly";
  payrollFrequencyRule(frequency);
  const earnings = Math.max(0, Number(input.earnings??input.monthlyEarnings??0));
  const band=thresholds[frequency];
  const workingAge = age >= 16 && age <= 74;
  const automaticEnrolmentAge = age >= 22 && age < 66;
  const qualifyingEarnings = Math.min(Math.max(earnings-band.lower,0),band.upper-band.lower);
  let category: PensionAssessment["category"] = "outside-scope";
  let action: PensionAssessment["action"] = "none";
  if (workingAge && automaticEnrolmentAge && earnings >= band.trigger) {
    category = "eligible-jobholder"; action = "enrol";
  } else if (workingAge && earnings > band.lower) {
    category = "non-eligible-jobholder"; action = "offer-opt-in";
  } else if (workingAge) {
    category = "entitled-worker"; action = "offer-join";
  }
  return {
    category,
    action,
    qualifyingEarnings: round(qualifyingEarnings),
    employeeContribution: round(qualifyingEarnings * ((input.employeeRate ?? 5) / 100)),
    employerContribution: round(qualifyingEarnings * ((input.employerRate ?? 3) / 100)),
  };
}

export function assessPensionAtDate(input: {
  dateOfBirth: string;
  assessmentDate: string;
  monthlyEarnings?:number;
  earnings?:number;
  payFrequency?:PayrollFrequency;
  employeeRate?: number;
  employerRate?: number;
}): PensionAssessment {
  const birth=new Date(`${input.dateOfBirth}T00:00:00Z`);
  const assessmentDate=new Date(`${input.assessmentDate}T00:00:00Z`);
  if(Number.isNaN(birth.getTime())||Number.isNaN(assessmentDate.getTime())||birth>assessmentDate)
    return assessPension({...input,age:-1});
  const age=assessmentDate.getUTCFullYear()-birth.getUTCFullYear()-
    (assessmentDate.getUTCMonth()<birth.getUTCMonth()||
    (assessmentDate.getUTCMonth()===birth.getUTCMonth()&&assessmentDate.getUTCDate()<birth.getUTCDate())?1:0);
  return assessPension({...input,age});
}
