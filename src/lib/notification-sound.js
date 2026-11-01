const patterns={chime:[660,880],bell:[880,660,880],short:[740]};
let audio;
export async function unlockNotificationAudio(browser=window) {
  const Audio=browser.AudioContext || browser.webkitAudioContext;
  if(!Audio)return false;
  try{audio ||= new Audio();if(audio.state==='suspended')await audio.resume();return audio.state==='running';}catch{return false;}
}
export function playNotificationSound({tone='chime',volume=.35}={}) {
  if(!audio || audio.state!=='running')return false;
  const notes=patterns[tone]||patterns.chime,level=Math.max(0,Math.min(.6,Number(volume)||0));
  if(!level)return false;
  const start=audio.currentTime;
  for(const [i,frequency] of notes.entries()){
    const oscillator=audio.createOscillator(),gain=audio.createGain(),at=start+i*.18;
    oscillator.type='sine';oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.015);gain.gain.exponentialRampToValueAtTime(.001,at+.16);
    oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+.18);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
  return true;
}
