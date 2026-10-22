import { mkdir,readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Restricted Windows hosts can briefly deny recreating a just-removed folder.
// Prepare output directories sequentially and retain them between local builds.
if (process.platform === 'win32') {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const directories=['','_not-found','_global-error'];
  async function scan(relative='') {
    for (const entry of await readdir(path.join(root,'src/app',relative),{ withFileTypes:true })) {
      if (!entry.isDirectory()) continue;
      const next=path.join(relative,entry.name);directories.push(next);await scan(next);
    }
  }
  await scan();
  for (const build of ['.next','.next/dev']) for (const prefix of ['server/app','static/chunks/app','types/app']) for (const relative of directories) {
    await mkdir(path.join(root,build,prefix,relative),{ recursive:true });
  }
  for (const build of ['.next','.next/dev']) for (const name of ['_not-found','_global-error']) {
    await mkdir(path.join(root,build,'server/app',name+'.segments',name),{ recursive:true });
  }
}
