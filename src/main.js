"use strict";

import client from './pet-store-on-heroku';

const message = document.getElementById('message');
message.innerHTML = 'Loading pet ...';

client.api.get({limit: 1}, (err, res) => {
  if (err) return console.error(err);
  console.log(res.data);
  message.innerHTML = res.data && res.data[0].name;
});


