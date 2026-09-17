const assert = require('assert');

const {
    extractMediaSessionInfo,
    extractHighestQualityArtwork,
    parseBylineInfo,
    extractRepeatMode,
    formatLargeImageText,
    isActualAlbum,
    buildActivityButtons
} = require('../extention/content.js');

console.log('Running YouTube Music Extraction & Fallback Tests...\n');

const allTests = [];
function test(name, fn) {
    allTests.push({ name, fn });
}

async function runAllTests() {
    let passedTests = 0;
    for (const t of allTests) {
        try {
            await t.fn();
            console.log(`  [PASS] ${t.name}`);
            passedTests++;
        } catch (err) {
            console.error(`  [FAIL] ${t.name}`);
            console.error(err);
            process.exitCode = 1;
        }
    }
    console.log(`\nTests completed: ${passedTests}/${allTests.length} passed.`);
    if (passedTests === allTests.length) {
        console.log('ALL EXTRACTION TESTS PASSED!\n');
    }
}

test('extractMediaSessionInfo extracts clean metadata and high-res artwork', () => {
    const mockMediaSession = {
        playbackState: 'playing',
        metadata: {
            title: 'Blinding Lights',
            artist: 'The Weeknd',
            album: 'After Hours',
            artwork: [
                { src: 'https://lh3.googleusercontent.com/s60', sizes: '60x60' },
                { src: 'https://lh3.googleusercontent.com/s120', sizes: '120x120' },
                { src: 'https://lh3.googleusercontent.com/s512', sizes: '512x512' }
            ]
        }
    };

    const result = extractMediaSessionInfo(mockMediaSession);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.track, 'Blinding Lights');
    assert.strictEqual(result.artist, 'The Weeknd');
    assert.strictEqual(result.album, 'After Hours');
    assert.strictEqual(result.albumArtUrl, 'https://lh3.googleusercontent.com/s512');
    assert.strictEqual(result.isPlaying, true);
});

test('extractMediaSessionInfo correctly handles paused state', () => {
    const mockMediaSession = {
        playbackState: 'paused',
        metadata: {
            title: 'Starboy',
            artist: 'The Weeknd, Daft Punk',
            album: 'Starboy',
            artwork: [{ src: 'https://lh3.googleusercontent.com/starboy512' }]
        }
    };

    const result = extractMediaSessionInfo(mockMediaSession);
    assert.strictEqual(result.isPlaying, false);
    assert.strictEqual(result.artist, 'The Weeknd, Daft Punk');
});

test('extractMediaSessionInfo returns null when metadata is empty, invalid, or missing title', () => {
    assert.strictEqual(extractMediaSessionInfo(null), null);
    assert.strictEqual(extractMediaSessionInfo({}), null);
    assert.strictEqual(extractMediaSessionInfo({ metadata: null }), null);
    assert.strictEqual(extractMediaSessionInfo({ metadata: { title: '', artist: 'Artist' } }), null);
    assert.strictEqual(extractMediaSessionInfo({ metadata: { title: 'Title', artist: '' } }), null);
    assert.strictEqual(extractMediaSessionInfo({ metadata: { title: '   ', artist: 'Artist' } }), null);
});

test('extractHighestQualityArtwork picks largest or last artwork element', () => {
    const list = [
        { src: 'https://lh3.googleusercontent.com/small', sizes: '60x60' },
        { src: 'https://lh3.googleusercontent.com/large', sizes: '512x512' }
    ];
    assert.strictEqual(extractHighestQualityArtwork(list), 'https://lh3.googleusercontent.com/large');
    assert.strictEqual(extractHighestQualityArtwork([]), null);
    assert.strictEqual(extractHighestQualityArtwork(null), null);
});

test('extractHighestQualityArtwork resolves protocol-relative URLs', () => {
    const list = [{ src: '//lh3.googleusercontent.com/image.jpg' }];
    assert.strictEqual(extractHighestQualityArtwork(list), 'https://lh3.googleusercontent.com/image.jpg');
});

test('parseBylineInfo extracts artist and album from multiple anchor elements', () => {
    const mockElement = {
        querySelectorAll: (selector) => {
            if (selector === 'a') {
                return [
                    { textContent: 'Daft Punk', href: 'https://music.youtube.com/channel/123' },
                    { textContent: 'Discovery', href: 'https://music.youtube.com/browse/MPREb_456' }
                ];
            }
            return [];
        },
        textContent: 'Daft Punk • Discovery • 2001'
    };

    const result = parseBylineInfo(mockElement);
    assert.strictEqual(result.artist, 'Daft Punk');
    assert.strictEqual(result.album, 'Discovery');
});

test('parseBylineInfo handles single artist anchor element with no album', () => {
    const mockElement = {
        querySelectorAll: (selector) => {
            if (selector === 'a') {
                return [{ textContent: 'Single Artist' }];
            }
            return [];
        },
        textContent: 'Single Artist'
    };

    const result = parseBylineInfo(mockElement);
    assert.strictEqual(result.artist, 'Single Artist');
    assert.strictEqual(result.album, null);
});

test('parseBylineInfo falls back to string splitting when no anchor tags are present', () => {
    const mockElement = {
        querySelectorAll: () => [],
        textContent: 'Kendrick Lamar • DAMN. • 2017'
    };

    const result = parseBylineInfo(mockElement);
    assert.strictEqual(result.artist, 'Kendrick Lamar');
    assert.strictEqual(result.album, 'DAMN.');
});

test('parseBylineInfo cleans up trailing commas and whitespace', () => {
    const mockElement = {
        querySelectorAll: () => [],
        textContent: 'Coldplay, • Parachutes • 2000'
    };

    const result = parseBylineInfo(mockElement);
    assert.strictEqual(result.artist, 'Coldplay');
    assert.strictEqual(result.album, 'Parachutes');
});

test('extractRepeatMode detects ONE, ALL, and defaults to NONE', () => {
    assert.strictEqual(extractRepeatMode({ getAttribute: (attr) => attr === 'repeat-mode' ? 'ONE' : null }), 'ONE');
    assert.strictEqual(extractRepeatMode({ getAttribute: (attr) => attr === 'repeat-mode' ? 'ALL' : null }), 'ALL');
    assert.strictEqual(extractRepeatMode({ getAttribute: () => null }), 'NONE');
    assert.strictEqual(extractRepeatMode(null), 'NONE');
});

test('formatLargeImageText includes only album when actual album is present, otherwise null', () => {
    assert.strictEqual(formatLargeImageText('Harder Better Faster Stronger', 'Daft Punk', 'Discovery'), 'Discovery');
    assert.strictEqual(formatLargeImageText('Sound Of You Laughing', 'ThxSoMch', 'Sound Of You Laughing'), null);
    assert.strictEqual(formatLargeImageText('Sound Of You Laughing (feat. Flawed Mangoes)', 'ThxSoMch', 'Sound Of You Laughing'), null);
    assert.strictEqual(formatLargeImageText('Song Without Album', 'Some Artist', null), null);
    assert.strictEqual(formatLargeImageText('Song Without Album', 'Some Artist', ''), null);
});

test('isActualAlbum distinguishes genuine albums from single releases repeating the track title', () => {
    assert.strictEqual(isActualAlbum('Blinding Lights', 'After Hours'), true);
    assert.strictEqual(isActualAlbum('Harder Better Faster Stronger', 'Discovery'), true);
    assert.strictEqual(isActualAlbum('Hello', '25'), true);

    assert.strictEqual(isActualAlbum('Sound Of You Laughing', 'Sound Of You Laughing'), false);
    assert.strictEqual(isActualAlbum('Sound Of You Laughing', 'sound of you laughing'), false);
    assert.strictEqual(isActualAlbum('Sound Of You Laughing (feat. Flawed Mangoes)', 'Sound Of You Laughing'), false);
    assert.strictEqual(isActualAlbum('Sound Of You Laughing [with Flawed Mangoes]', 'Sound Of You Laughing'), false);
    assert.strictEqual(isActualAlbum('Sound Of You Laughing', 'Sound Of You Laughing - Single'), false);
    assert.strictEqual(isActualAlbum('Sound Of You Laughing', 'Sound Of You Laughing (Single)'), false);
    assert.strictEqual(isActualAlbum('Sound Of You Laughing', 'Sound Of You Laughing - EP'), false);
    assert.strictEqual(isActualAlbum('Song [Official Music Video]', 'Song'), false);
    assert.strictEqual(isActualAlbum('Song (Remastered 2021)', 'Song'), false);

    assert.strictEqual(isActualAlbum('Song', null), false);
    assert.strictEqual(isActualAlbum('Song', ''), false);
    assert.strictEqual(isActualAlbum('Song', '   '), false);
    assert.strictEqual(isActualAlbum(null, 'Album'), false);
    assert.strictEqual(isActualAlbum('', 'Album'), false);
});

test('buildActivityButtons uses direct video link when videoId is valid', () => {
    const buttons = buildActivityButtons('Get Lucky', 'Daft Punk', '5NV6Rdv1a3I', null, false);
    assert.strictEqual(buttons[0].label, 'Link');
    assert.strictEqual(buttons[0].url, 'https://music.youtube.com/watch?v=5NV6Rdv1a3I');
    assert.strictEqual(buttons[1].label, 'GitHub');
});

test('buildActivityButtons falls back to search link when videoId is missing or invalid', () => {
    const buttons = buildActivityButtons('Get Lucky', 'Daft Punk', null, null, false);
    assert.strictEqual(buttons[0].label, 'Link');
    assert.strictEqual(buttons[0].url, `https://music.youtube.com/search?q=${encodeURIComponent('Daft Punk Get Lucky')}`);
});

test('buildActivityButtons includes Listen Together button when hosting session', () => {
    const buttons = buildActivityButtons('Get Lucky', 'Daft Punk', '5NV6Rdv1a3I', 'YTM-ABC123', true);
    assert.strictEqual(buttons[0].label, 'Listen Along');
    assert(
        buttons[0].url === 'https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=YTM-ABC123' ||
        buttons[0].url === 'http://127.0.0.1:5500/docs/index.html?ytm-session=YTM-ABC123',
        'Should include valid Listen Along session URL'
    );
    assert.strictEqual(buttons[0].url, 'https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=YTM-ABC123');
    assert.strictEqual(buttons[1].label, 'Link');
    assert.strictEqual(buttons[1].url, 'https://music.youtube.com/watch?v=5NV6Rdv1a3I');
});

test('single release metadata does not trigger redundant album change updates', () => {
    const track = 'Sound Of You Laughing';
    const initialAlbum = null;
    const delayedAlbumArrival = 'Sound Of You Laughing';

    const cleanInitial = isActualAlbum(track, initialAlbum) ? initialAlbum : null;
    const cleanDelayed = isActualAlbum(track, delayedAlbumArrival) ? delayedAlbumArrival : null;

    assert.strictEqual(cleanInitial, null);
    assert.strictEqual(cleanDelayed, null);
    assert.strictEqual(cleanInitial !== cleanDelayed, false);
});

test('distinct album metadata triggers update and sets clean album text', () => {
    const track = 'Blinding Lights';
    const initialAlbum = null;
    const delayedAlbumArrival = 'After Hours';

    const cleanInitial = isActualAlbum(track, initialAlbum) ? initialAlbum : null;
    const cleanDelayed = isActualAlbum(track, delayedAlbumArrival) ? delayedAlbumArrival : null;

    assert.strictEqual(cleanInitial, null);
    assert.strictEqual(cleanDelayed, 'After Hours');
    assert.strictEqual(cleanInitial !== cleanDelayed, true);
    assert.strictEqual(formatLargeImageText(track, 'The Weeknd', cleanDelayed), 'After Hours');
});

runAllTests();
