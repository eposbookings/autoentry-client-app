export const cashDenominations=[
  {label:"£50",pence:5000},{label:"£20",pence:2000},{label:"£10",pence:1000},{label:"£5",pence:500},
  {label:"£2",pence:200},{label:"£1",pence:100},{label:"50p",pence:50},{label:"20p",pence:20},
  {label:"10p",pence:10},{label:"5p",pence:5},{label:"2p",pence:2},{label:"1p",pence:1},
] as const;

export function cashMakeup(amount:number){
  if(!Number.isFinite(amount)||amount<0)throw new Error("Cash payment must be a valid non-negative amount.");
  let remaining=Math.round(amount*100);
  const counts=cashDenominations.map(denomination=>{
    const count=Math.floor(remaining/denomination.pence);
    remaining-=count*denomination.pence;
    return count;
  });
  return {amount:Math.round(amount*100)/100,counts};
}
