# Boys' Brigade Monopoly Challenge Route Planner

A phone-friendly route planner for the Boys' Brigade Monopoly Challenge in Bristol. Paste in the list of locations at the start, and it plans a walking route that fits in as many group selfies as possible before the deadline, ending at the finish if there is one. During the day you can tick off selfies, see the route and your position on a map, change the pace and re-plan from wherever you are.

**Open it on your phone:** https://tnc1997.github.io/boys-brigade-monopoly-challenge-route-planner/

This is an unofficial tool made by a team taking part. It isn't run or endorsed by the Boys' Brigade, and the challenge's own rules and instructions always come first.

Open it once with signal before the challenge starts. After that it works without signal too, apart from the map's background and looking up new addresses.

## On the day

### 1. Set up

1. Open the planner and check the **Start** (Castle Park by default), **Deadline** (16:00), **Walking speed** and **Selfie time**. Set the walking speed to the pace of the slowest walker, because the team must stay together.
2. Leave **Finish** blank if there's no finish point. Otherwise, enter it in the same way as a location (see below). You can add, change or clear it later.
3. Leave **Start time** blank to start now, or enter the time you'll set off.
4. Paste or type the locations into **Locations**, one per line. As you type, each line shows ✓ when it's ready, ⌕ when it will be looked up, or ✗ with what's wrong.
5. Press **Plan route**.

### 2. Writing each location

Each line needs one of these:

| What you have | What to type | Example |
|---|---|---|
| An address or place name | Just the address. It's looked up with OpenStreetMap. | `Queen Square, Bristol` |
| A label and an address | The label, a colon, then the address | `Old Kent Road: Queen Square, Bristol` |
| Coordinates | Latitude and longitude, with any label | `Temple Meads 51.4492,-2.5813` |
| A full Google Maps link | The link, with any label | `Cabot Tower https://www.google.com/maps?q=51.4517,-2.6034` |

**Or drop a pin on the map.** On the **Map** tab, long-press the spot (or right-click it on a computer) and give it a name. It's added to the end of **Locations** as a line with its coordinates. Until you press **Plan route** or **Re-plan from here**, it shows on the map as a dashed **+**. To remove it, delete its line from **Locations**, and plan again if it's already in the route.

After planning, each address line shows what it matched, like `Line 2: Old Kent Road → Queen Square, City Centre, Bristol`, and the **Looked up** list does the same for the Start and Finish. Check they're the right places.

**what3words addresses can't be used directly.** Converting them to coordinates needs a paid what3words plan, so the planner rejects a line with a what3words address and tells you what to do. For each one, either:

- **Use its address:** open the address in the free what3words app, tap **Navigate**, and copy the street address it hands to the maps app onto the line, or
- **Use its coordinates:** find the square in what3words, then long-press the same spot in Google Maps to drop a pin. Its coordinates appear in the search box at the top, ready to copy onto the line.

**Short Google Maps links** (`maps.app.goo.gl/…`), which the Google Maps app's Share button gives you, can't be read. Drop a pin and copy its coordinates instead.

**Only one phone should look up a fresh list of addresses.** OpenStreetMap's free address search allows 1 request per second for everyone using the planner together, and the planner waits 1.5 seconds between lookups. If several phones plan the same new list at once, they can go over that limit. Each phone saves its results, so later plans and re-plans don't look anything up again. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

### 3. Follow the route

- The **List** tab shows each stop in order with its ETA, the walk to it, and a **Google Maps** button that opens walking directions. On an iPhone, iPad or Mac there's also an **Apple Maps** button. Locations that don't fit are listed under **Skipped**.
- The **Map** tab shows the numbered stops, the route line, the finish, skipped locations in grey, and your position as a blue dot.
- After each selfie, tap **Mark selfie done**. The counter shows how many are done.
- The header shows a countdown to the deadline. A red banner warns you when time is nearly up ("Head to the finish now", or "Last few selfies" without a finish), or when you're running behind the plan.

### 4. Re-plan when things change

Press **Re-plan from here** at any time. It plans again from where you are now and the current time, using only the locations you haven't ticked off. Do this:

- **After a bus or train:** re-plan from where you get off.
- **When you're running behind,** or the red banner says so.
- **When the pace changes,** for example if people leave or the group tires. Open **⚙ Settings**, choose **Slow** (3.5 km/h), **Medium** (4.5 km/h), **Fast** (5.5 km/h) or use the slider, then press **Save and re-plan**.
- **When the finish changes.** The settings panel also lets you change the selfie time, safety margin (spare time kept before the deadline), detour factor (how much further walking is than a straight line), deadline and, if the organisers have one, the link to their online check-in form.

The line under the Route heading shows what the plan assumes, such as "Planning for Medium 4.5 km/h · 3 min/selfie".

To start over with a new list, press **New challenge**. It keeps your settings.

## Rules to remember

- **Stay together at all times.** The planner plans one route for the whole team.
- **Allowed:** walking, buses and trains.
- **Not allowed:** bikes, e-scooters, cars, taxis and Ubers.
- **Be at the finish by the deadline** (16:00).

The planner only knows about walking. If you take a bus or train, press **Re-plan from here** once you get off.

## How it works

- **Planning:** the planner estimates walking time from the straight-line distance multiplied by the detour factor, at the walking speed, plus the selfie time at each stop. It builds a route by adding the location that costs the least extra time, then improves it by reversing sections (2-opt) and by swapping one stop for others. It repeats this from several starting points, all within 200 ms, and keeps the best route.
- **Your data stays on the phone:** everything you enter is saved in the browser only.
- **External services:** address searches go to [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/), and map tiles come from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors). Both are free within their usage policies, which the code follows.

## Development

The site is static, with no framework. The modules are plain JavaScript with JSDoc, and Tailwind CSS generates `styles.css`.

```sh
npm install   # install the dev tools
npm start     # serve on http://localhost:3000 and rebuild the styles as you edit
npm test      # run the tests with node --test
npm run build # build the minified styles.css
```

| File | What it does |
|---|---|
| `index.html`, `app.js` | The page and the code that runs it |
| `planner.js` | Walking times and route planning |
| `locations.js` | Reading location lines (coordinates, Google Maps links, addresses) |
| `search.js` | Address lookups with Nominatim |
| `setup.js` | Turning the setup form into a plan |
| `route.js` | Describing the plan for the list, the map, the warning banner and the countdown |
| `map.js` | The Leaflet map |
| `settings.js` | Walking speed presets, the settings summary and checking the check-in form URL |
| `storage.js` | Saving the state in the browser |
| `sw.js` | The service worker that keeps the app working offline |

Pushes to `main` are tested by the **Test** workflow and deployed to GitHub Pages by the **Deploy** workflow.
