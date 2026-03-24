const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');
code = code.replace(`                                    ))}
                                  </div>
                                </div>
                          {selectedEmitterProperties.particleType ===`, `                                    ))}
                                  </div>
                                </div>
                            </>
                          )}

                          {selectedEmitterProperties.particleType ===`);
fs.writeFileSync('src/App.tsx', code);
