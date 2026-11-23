import '../src/silence-sqlite-warning.js';
import 'dotenv/config';
import { openDb } from '../src/db/repo.js';

const file = process.env.DATABASE_PATH ?? './data/bot.db';
openDb(file).close(); // openDb가 대기 중인 마이그레이션을 적용한다
console.log(`✔ 마이그레이션 적용 완료: ${file}`);
