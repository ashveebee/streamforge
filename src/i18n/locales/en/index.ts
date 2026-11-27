// Generated: each area of the app has its own file. Add an area in en/ first.
import core from './core';
import library from './library';
import media from './media';
import ui from './ui';
import watch from './watch';
import widgets from './widgets';

const en = { ...core, library, media, ui, watch, widgets };

export type Messages = typeof en;
export default en;
