import type { PlayUrlResponse } from '../services/types';

/**
 * 从 Bilibili DASH 响应生成 MPD data URI。
 * 选取 id === qn 的视频流（找不到则取第一条），带宽最高的音频流。
 * 返回 "data:application/dash+xml;base64,..." 供 react-native-video (ExoPlayer) 使用。
 */
export function buildDashDataUri(playData: PlayUrlResponse, qn: number): string {
  const dash = playData.dash!;

  const video = dash.video.find(v => v.id === qn) ?? dash.video[0];
  const audio = dash.audio.reduce((best, a) =>
    a.bandwidth > best.bandwidth ? a : best
  );

  const dur = dash.duration;

  const vSeg = video.segment_base;
  const aSeg = audio.segment_base;

  const videoSegmentBase = vSeg
    ? `\n        <SegmentBase indexRange="${vSeg.index_range}">\n          <Initialization range="${vSeg.initialization}"/>\n        </SegmentBase>`
    : '';
  const audioSegmentBase = aSeg
    ? `\n        <SegmentBase indexRange="${aSeg.index_range}">\n          <Initialization range="${aSeg.initialization}"/>\n        </SegmentBase>`
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT${dur}S">
  <Period duration="PT${dur}S">
    <AdaptationSet id="1" mimeType="${video.mimeType}" codecs="${video.codecs}" startWithSAP="1" subsegmentAlignment="true">
      <Representation id="v1" bandwidth="${video.bandwidth}" width="${video.width}" height="${video.height}" frameRate="${video.frameRate}">
        <BaseURL>${escapeXml(video.baseUrl)}</BaseURL>${videoSegmentBase}
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="2" mimeType="${audio.mimeType}" codecs="${audio.codecs}" startWithSAP="1" subsegmentAlignment="true">
      <Representation id="a1" bandwidth="${audio.bandwidth}">
        <BaseURL>${escapeXml(audio.baseUrl)}</BaseURL>${audioSegmentBase}
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  return `data:application/dash+xml;base64,${btoa(xml)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
