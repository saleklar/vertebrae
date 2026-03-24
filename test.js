function evaluateCurve(curveJson, t, defaultValue = 1) {
    if (!curveJson) return defaultValue;
    try {
      const points = JSON.parse(curveJson);
      if (!Array.isArray(points) || points.length === 0) return defaultValue;
      if (points.length === 1) return points[0].y;
      
      const sortedPoints = [...points].sort((a, b) => a.x - b.x);

      if (t <= sortedPoints[0].x) return sortedPoints[0].y;
      if (t >= sortedPoints[sortedPoints.length - 1].x) return sortedPoints[sortedPoints.length - 1].y;

      for (let i = 0; i < sortedPoints.length - 1; i++) {
         const p1 = sortedPoints[i];
         const p2 = sortedPoints[i+1];
         if (t >= p1.x && t <= p2.x) {
           if (p1.rx !== undefined || p2.lx !== undefined) {
               const cp1x = p1.rx !== undefined ? p1.rx : p1.x + (p2.x - p1.x) / 3;
               const cp1y = p1.ry !== undefined ? p1.ry : p1.y + (p2.y - p1.y) / 3;
               const cp2x = p2.lx !== undefined ? p2.lx : p2.x - (p2.x - p1.x) / 3;
               const cp2y = p2.ly !== undefined ? p2.ly : p2.y - (p2.y - p1.y) / 3;
               
               let lower = 0;
               let upper = 1;
               let u = 0.5;
               for (let iter = 0; iter < 15; iter++) {
                   const invU = 1 - u;
                   const currentX = invU*invU*invU*p1.x + 3*invU*invU*u*cp1x + 3*invU*u*u*cp2x + u*u*u*p2.x;
                   if (currentX < t) lower = u;
                   else upper = u;
                   u = (lower + upper) / 2;
               }
               const invU = 1 - u;
               return invU*invU*invU*p1.y + 3*invU*invU*u*cp1y + 3*invU*u*u*cp2y + u*u*u*p2.y;
           } else {
               const segmentT = (t - p1.x) / (p2.x - p1.x);
               return p1.y + (p2.y - p1.y) * segmentT;
           }
         }
      }
    } catch(e) {}
    return defaultValue;
}
const testStr = '[{\"x\":0,\"y\":0},{\"x\":0.5,\"y\":1},{\"x\":1,\"y\":0}]';
console.log(evaluateCurve(testStr, 0.0));
console.log(evaluateCurve(testStr, 0.25));
console.log(evaluateCurve(testStr, 0.5));
console.log(evaluateCurve(testStr, 0.75));
console.log(evaluateCurve(testStr, 1.0));
