export type MileageVehicle="car-van"|"motorcycle"|"cycle";

const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function calculateMileageAllowance(input:{vehicle:MileageVehicle;miles:number;ytdMiles:number;paidRate:number;taxYear:string}){
  const miles=Number(input.miles),ytdMiles=Number(input.ytdMiles),paidRate=Number(input.paidRate);
  if(input.taxYear!=="2026/27")throw new Error("Mileage rates are installed only for 2026/27.");
  if(!["car-van","motorcycle","cycle"].includes(input.vehicle)||![miles,ytdMiles,paidRate].every(Number.isFinite)||miles<=0||ytdMiles<0||paidRate<0)
    throw new Error("Vehicle, business miles, year-to-date miles and paid rate must be valid.");
  const standard=input.vehicle==="motorcycle"?.24:input.vehicle==="cycle"?.20:.55;
  const firstBand=input.vehicle==="car-van"?Math.max(0,Math.min(miles,10_000-ytdMiles)):miles;
  const laterBand=miles-firstBand;
  const taxApproved=round(firstBand*standard+laterBand*(input.vehicle==="car-van"?.25:standard));
  const nicApproved=round(miles*standard),paid=round(miles*paidRate);
  const exempt=round(Math.min(paid,taxApproved));
  const taxOnlyExcess=round(Math.min(Math.max(0,paid-taxApproved),Math.max(0,nicApproved-taxApproved)));
  const taxAndNicExcess=round(Math.max(0,paid-taxApproved-taxOnlyExcess));
  return {vehicle:input.vehicle,miles,ytdMilesBefore:ytdMiles,ytdMilesAfter:ytdMiles+miles,paidRate,paid,taxApproved,nicApproved,exempt,taxOnlyExcess,taxAndNicExcess,mileageReliefShortfall:round(Math.max(0,taxApproved-paid))};
}
