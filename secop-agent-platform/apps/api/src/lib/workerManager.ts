import { EventEmitter } from 'events';

export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(100);
