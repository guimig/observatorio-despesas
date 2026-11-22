/** Abertura consistente para dialogos longos, inclusive reuso do mesmo pop-up. */
export function showDialogFromTop(dialog,frame=callback=>requestAnimationFrame(callback)){
  if(!dialog.open)dialog.showModal();
  const reset=()=>{
    if(!dialog.open)return;
    dialog.scrollTop=0;
    const content=dialog.querySelector('.dialog-content');
    if(content)content.scrollTop=0;
  };
  reset();
  // Evita que foco automatico e layout apos showModal restaurem a rolagem anterior.
  dialog.querySelector('.dialog-heading button')?.focus({preventScroll:true});
  frame(reset);
}
