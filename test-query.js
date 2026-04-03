const fs = require('fs');
fetch('http://localhost:8080/api/notes/query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer dev-token'
  },
  body: JSON.stringify({
    dateField: 'created'
  })
}).then(res => res.json()).then(data => {
  if (data.notes && data.notes.length > 0) {
    const note = data.notes.find(n => n.title.includes('Goldman') || n.title.includes('地缘'));
    console.log(note ? JSON.stringify(note.content).substring(0, 800) : "Not found");
  } else {
    console.log("No notes");
  }
}).catch(console.error);
