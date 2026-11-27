// Every area of the app has its own file. A new area goes in en/ first, then here and in each language.
import core from './core';
import admin from './admin';
import kometa from './kometa';
import library from './library';
import media from './media';
import sec from './sec';
import svc from './svc';
import ui from './ui';
import watch from './watch';
import widgets from './widgets';

const en = { ...core, admin, kometa, library, media, sec, svc, ui, watch, widgets };

export type Messages = typeof en;
export default en;
