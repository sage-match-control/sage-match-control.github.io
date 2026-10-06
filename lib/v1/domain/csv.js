// CSV text -> rows of cells. Quoted fields, doubled quotes, \r\n and blank
// lines are handled; a row of one empty cell is dropped.
//
// Every snapshot carries its sheets as CSV text (matchesCsv, standingsCsv,
// rosterCsv), and every page reads them through this one function.

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\r'){ /* skip */ }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else field += c;
    }
  }
  if(field.length>0 || row.length>0){ row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}
