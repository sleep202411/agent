import { cp, mkdir, rm, access } from 'node:fs/promises';
const source = new URL('../../app-story-agent/dist/ui/', import.meta.url);
const destination = new URL('../public/app-story-agent/', import.meta.url);
await access(new URL('index.html', source));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
