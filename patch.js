const fs = require('fs');
let code = fs.readFileSync('e:/VIBE_PROJECTS/vertebrae/src/App.tsx', 'utf8');
code = code.replace(/import \* as THREE from 'three';/, "import * as THREE from 'three';\nimport { loadImagesFromDB, saveImageToDB, deleteImageFromDB, StoredImage } from './imageStorage';");
code = code.replace("const [showFireModal, setShowFireModal] = useState(false);", "const [showFireModal, setShowFireModal] = useState(false);\n  const [spriteLibrary, setSpriteLibrary] = useState<StoredImage[]>([]);\n  useEffect(() => {\n    loadImagesFromDB().then((imgs) => setSpriteLibrary(imgs));\n  }, []);");
fs.writeFileSync('e:/VIBE_PROJECTS/vertebrae/src/App.tsx', code);
console.log('App.tsx fixed');
