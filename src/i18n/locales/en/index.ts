// Generated: each area of the app has its own file. Add an area in en/ first.
import core from './core';
import ui from './ui';
import widgets from './widgets';

const en = { ...core, ui, widgets };

export type Messages = typeof en;
export default en;
