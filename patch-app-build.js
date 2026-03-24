const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const importAdd = \import { loadImagesFromDB, saveImageToDB, deleteImageFromDB, StoredImage } from './imageStorage';\nimport { createRoot } from 'react-dom/client';\;
code = code.replace(/import \{ createRoot \} from 'react-dom\/client';/, importAdd);

const stateAdd = \const [spriteLibrary, setSpriteLibrary] = useState<StoredImage[]>([]);\n  useEffect(() => { loadImagesFromDB().then(setSpriteLibrary); }, []);\n  const [copiedProps, setCopiedProps]\;
code = code.replace(/const \\\[copiedProps, setCopiedProps\\\]/, stateAdd);

fs.writeFileSync('src/App.tsx', code);
console.log('patched build errors');
