import webpush from 'web-push';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const subject=process.argv[2];
if(!subject || !/^(?:https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(subject))throw Error('Provide the real production HTTPS origin or a mailto: contact.');
const keys=webpush.generateVAPIDKeys();
const target=path.resolve('.env.push.local');
await writeFile(target,`# Private server configuration. Never commit or share this file.\nSOEICAM_PUSH_ENABLED=true\nVAPID_SUBJECT=${subject}\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,{flag:'wx',mode:0o600});
console.log('Created .env.push.local. Copy its values into the production server environment. Existing keys were not overwritten.');
