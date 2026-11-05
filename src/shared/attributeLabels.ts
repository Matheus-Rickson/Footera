/** Nomes dos atributos em português (telas, CSV de pacotes). */
export const ATTR_LABEL: Record<string, string> = {
  finishing: 'Finalização', passing: 'Passe', dribbling: 'Drible', tackling: 'Desarme', marking: 'Marcação', firstTouch: 'Primeiro toque', crossing: 'Cruzamento',
  heading: 'Cabeceio', longShots: 'Chute de longe', goalkeeping: 'Goleiro (geral)', vision: 'Visão de jogo', composure: 'Compostura', decisions: 'Decisões',
  positioning: 'Posicionamento', workRate: 'Empenho', leadership: 'Liderança', aggression: 'Agressividade', pace: 'Velocidade', stamina: 'Resistência',
  strength: 'Força física', agility: 'Agilidade', jumping: 'Impulsão', naturalFitness: 'Preparo natural',
  reflexes: 'Reflexos', oneOnOne: 'Um contra um', handling: 'Manejo', aerial: 'Jogo aéreo', rushingOut: 'Saídas do gol', kicking: 'Reposição',
};
/** Grupo de cada atributo (para montar o registro do pacote). */
export const ATTR_GROUP: Record<string, 'technical' | 'mental' | 'physical' | 'goalkeeper'> = {
  finishing: 'technical', passing: 'technical', dribbling: 'technical', tackling: 'technical', marking: 'technical', firstTouch: 'technical', crossing: 'technical', heading: 'technical', longShots: 'technical',
  vision: 'mental', composure: 'mental', decisions: 'mental', positioning: 'mental', workRate: 'mental', leadership: 'mental', aggression: 'mental',
  pace: 'physical', stamina: 'physical', strength: 'physical', agility: 'physical', jumping: 'physical', naturalFitness: 'physical',
  reflexes: 'goalkeeper', oneOnOne: 'goalkeeper', handling: 'goalkeeper', aerial: 'goalkeeper', rushingOut: 'goalkeeper', kicking: 'goalkeeper',
};
