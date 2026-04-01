const ids = ['9bd082a8-809c-4354-962b-08660e3735a7', 'b73dbf91-d92f-4e1c-9be3-feddb99e32cd'];
fetch('http://localhost:8080/api/canvas-sync/classify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + process.env.TOKEN
  },
  body: JSON.stringify({ transcriptionIds: ids })
}).then(r => r.json()).then(r => console.log(JSON.stringify(r.classifications, null, 2)));
