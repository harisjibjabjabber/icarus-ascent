import { Game } from './game';

const root = document.getElementById('app')!;
const game = new Game(root);
const loop = (t: number) => { game.frame(t); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
