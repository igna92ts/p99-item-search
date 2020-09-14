const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const baseUrl = 'https://wiki.project1999.com'

const responses = {};
const fetch = async url => {
  if (responses[url]) {
    return responses[url];
  } else {
    let errResponse;
    let response = await axios.get(url).catch(err => {
      if (err.response.status === 404)
        errResponse = err.response;
    });
    if (errResponse) response = errResponse;
    responses[url] = response;
    return response;
  }
}

const sleep = () => new Promise((resolve, reject) => {
  setTimeout(() => resolve(), 100);
});

const getUrl = (eqClass, category) =>
  `${baseUrl}/Special:ClassSlotEquip/${eqClass}/${category}/AllItems`;

const getStat = (index, column, $) => {
  if ($(column).find('td').toArray().length === 19) {
    index++;
  }
  return Number($($(column).find('td')[index]).text()) || 0;
}

const parseCategory = async (eqClass, category) => {
  console.log(`Getting category ${category} for class ${eqClass}`);
  const { data } = await fetch(getUrl(eqClass, category));
  const $ = cheerio.load(data);
  const [first, ...rest] = $('tbody>tr').toArray();
  const items = rest.map(column => ({
    name: $(column).find('td>div>a')[0].attribs.title,
    stats: {
      ...(
        $(column).find('td').toArray().length === 19 ?
          { DMG: $($(column).find('td')[1]).text() } :
        {}
      ),
      AC: getStat(2, column, $),
      STR: getStat(4, column, $),
      STA: getStat(5, column, $),
      AGI: getStat(6, column, $),
      DEX: getStat(7, column, $),
      CHA: getStat(8, column, $),
      INT: getStat(9, column, $),
      WIS: getStat(10, column, $),
      HP: getStat(11, column, $),
      MANA: getStat(12, column, $),
      MR: getStat(13, column, $),
      FR: getStat(14, column, $),
      CR: getStat(15, column, $),
      PR: getStat(16, column, $),
      DR: getStat(17, column, $),
    },
    url: `${baseUrl}${$(column).find('td>div>a')[0].attribs.href}`,
    category
  }));
  const parsedItems = [];
  const p = items.reduce((promise, item) => {
    return promise.then(sleep()).then(async () => {
      const parsedItem = await parseItem(item);
      if (parsedItem) {
        const trueParsedItem = await parseMonsters(parsedItem);
        const megaTrueParsedItem = await parseQuests(trueParsedItem);
        parsedItems.push(megaTrueParsedItem);
      }
    });
  }, Promise.resolve())
  return p.then(() => parsedItems);
};

const parseItem = async item => {
  try {
    console.log(`Getting item with url [${item.url}]`);
    const { data } = await fetch(item.url);
    const $ = cheerio.load(data);
    if ($(':contains(NON-P99)')[0] || $(':contains(no text in this page)')[0] || $(':contains(This page needs a revamp or clean-up)')[0] || $('.redirectText>a')[0]) {
      return null;
    }
    console.log(`Parsing item monsters for url [${item.url}]`);
    const startItem = {
      ...item,
      zones: [],
      monsters: [],
      vendors: !$('#Sold_by>span.esec')[0],
      quests: [],
      craftable: !$('#Player_crafted>span.esec')[0],
    }
    const zoneElements = $('#Drops_From')
      .closest('h2')
      .nextUntil($('#Sold_by').closest('h2'), 'p, ul')
      .toArray();
    let parsedItem = zoneElements.reduce((accum, e) => {
      if (e.tagName.toUpperCase() === 'P' && e.children.length && e.children[0].attribs) accum.zones.push(e.children[0].attribs.title);
      else if ($(e).find('li>a:not(.autonumber)')[0]) {
        $(e).find('li>a').map((i, m) => {
          accum.monsters.push({
            name: m.attribs.title,
            url: `${baseUrl}${m.attribs.href}`,
            zone: accum.zones[accum.zones.length - 1]
          });
        });
      }
      return accum;
    }, startItem);
    if (!$('#Related_quests>span.esec')[0]) {
      console.log(`Parsing item quests for url [${item.url}]`);
      const questElements = $('#Related_quests')
        .closest('h2')
        .nextUntil($('#Player_crafted').closest('h2'), 'ul')
        .toArray();
      parsedItem = questElements.reduce((accum, e) => {
        if ($(e).find('li>a')[0]) {
          accum.quests.push({
            name: $(e).find('li>a')[0].attribs.title,
            url: `${baseUrl}${$(e).find('li>a')[0].attribs.href}`
          });
        }
        return accum;
      }, parsedItem);
    }
    return parsedItem
  } catch (err) {
    debugger;
  }
};

const getMonster = async (parsedMonsters, monster) => {
  try {
    console.log(`Getting monster with url ${monster.url}`);
    const { data } = await fetch(monster.url);
    let $ = cheerio.load(data);
    if ($(':contains(NON-P99)')[0] || $(':contains(no text in this page)')[0] || $(':contains(This page needs a revamp or clean-up)')[0]) {
      return;
    }
    if ($('.redirectText>a')[0]) {
      const aElement = $('.redirectText>a')[0].attribs;
      const url = `${baseUrl}${aElement.href}`;
      const { data } = await fetch(url);
      $ = cheerio.load(data);
      monster.url = url;
      monster.name = aElement.title;
    }
    if ($(':contains(This page is intended to disambiguate articles with similar names)')[0]) {
      const monsters = $('#mw-content-text>ul>li>a')
        .toArray()
        .map(e => ({
          zone: monster.zone,
          name: e.attribs.title,
          url: `${baseUrl}${e.attribs.href}`
        }))
      for (let i = 0; i < monsters.length; i++) {
        await getMonster(parsedMonsters, monsters[i]);
      }
    } else if (!$('table.mobStatsBox>tbody>tr>td')[0] && $('div#mw-content-text>div>i:contains(Were you looking for)>a')[0]) {
      const monsters = $('div#mw-content-text>div>i:contains(Were you looking for)>a')
        .toArray()
        .map(e => ({ zone: monster.zone, name: e.attribs.title, url: `${baseUrl}${e.attribs.href}` }))
      for (let i = 0; i < monsters.length; i++) {
        await getMonster(parsedMonsters, monsters[i]);
      }
    } else {
      if ($('table.mobStatsBox>tbody>tr>td')[2]) {
        const level = $('table.mobStatsBox>tbody>tr>td')[2].children[2].data.split('-');
        if (level[0].indexOf('?') > -1) {
          level[0] = 100;
        }
        const from = parseInt(level[0]);
        const to = parseInt(level[1] || level[0]);
        parsedMonsters.push({ ...monster, level: { from, to } });
      } else {
        parsedMonsters.push({ ...monster, level: {} });
      }
    }
  } catch (err) {
    console.log(err);
    return;
  }
}

const parseMonsters = async item => {
  const parsedMonsters = [];
  const p = item.monsters.reduce((promise, monster) => {
    return promise.then(sleep()).then(async () => {
      return getMonster(parsedMonsters, monster);
    });
  }, Promise.resolve())
  return p.then(() => ({ ...item, monsters: parsedMonsters }));
}

const getQuest = async (parsedQuests, quest) => {
  try {
    console.log(`Getting quest with url ${quest.url}`);
    const { data } = await fetch(quest.url);
    let $ = cheerio.load(data);
    if ($(':contains(NON-P99)')[0] || $(':contains(no text in this page)')[0] || $(':contains(This page needs a revamp or clean-up)')[0]) {
      return;
    }
    if ($('.redirectText>a')[0]) {
      const aElement = $('.redirectText>a')[0].attribs;
      const url = `${baseUrl}${aElement.href}`;
      const { data } = await fetch(url);
      $ = cheerio.load(data);
      quest.url = url;
      quest.name = aElement.title;
    }
    if ($(':contains(This page is intended to disambiguate articles with similar names)')[0]) {
      const quests = $('#mw-content-text>ul>li>a')
        .toArray()
        .map(e => ({
          name: e.attribs.title,
          url: `${baseUrl}${e.attribs.href}`
        }))
      for (let i = 0; i < quests.length; i++) {
        await getQuest(parsedQuests, quests[i]);
      }
    } else if (!$('table.questTopTable>tbody>tr>td')[0] && $('div#mw-content-text>div>i:contains(Were you looking for)>a')[0]) {
      const quests = $('div#mw-content-text>div>i:contains(Were you looking for)>a')
        .toArray()
        .map(e => ({ name: e.attribs.title, url: `${baseUrl}${e.attribs.href}` }))
      for (let i = 0; i < quests.length; i++) {
        await getQuest(parsedQuests, quests[i]);
      }
    } else {
      if ($('table.questTopTable>tbody>tr>td')[2]) {
        const level = parseInt($('table.questTopTable>tbody>tr>td')[2].textContent);
        parsedQuests.push({ ...quest, level: { from: level, to: level } });
      } else {
        parsedQuests.push({ ...quest, level: {} });
      }
    }
  } catch (err) {
    console.log(err);
    return;
  }
}
const parseQuests = async item => {
  const parsedQuests = [];
  const p = item.quests.reduce((promise, quest) => {
    return promise.then(sleep()).then(async () => {
      return getQuest(parsedQuests, quest);
    });
  }, Promise.resolve());
  return p.then(() => ({ ...item, quests: parsedQuests }));
};


const categories = [
  'Arms',
  'Back',
  'Chest',
  'Ear',
  'Face',
  'Feet',
  'Fingers',
  'Hands',
  'Head',
  'Legs',
  'Neck',
  'Shoulders',
  'Waist',
  'Wrist',
  'Piercing',
  'Archery',
  'Primary',
  'Secondary'
];

const classes = [
  'Bard',
  'Cleric',
  'Druid',
  'Enchanter',
  'Magician',
  'Monk',
  'Necromancer',
  'Paladin',
  'Ranger',
  'Rogue',
  'Shadow_Knight',
  'Shaman',
  'Warrior',
  'Wizard'
];

const run = async () => {
  const eqClass = 'Ranger';
  const items = await categories.reduce(async (promise, category) => {
    const accum = await promise;
    const catItems = await parseCategory(eqClass, category);
    return [...accum, ...catItems];
  });
  // const category = await parseCategory(classes[0], categories[0]);
  // const test = await parseItem({ url: 'https://wiki.project1999.com/Stonemelder%27s_Band' });
  // const items = await parseMonsters({ monsters: [{ zone: 'bla', url: 'https://wiki.project1999.com/Evil_Eye' }]});
  fs.writeFileSync(`${eqClass}-items.json`, JSON.stringify(items, 0 ,2));
};

run();
