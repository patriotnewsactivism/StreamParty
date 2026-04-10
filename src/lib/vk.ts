// VK API utilities for video fetching

const VK_API_VERSION = '5.131';

export async function getVkVideoMp4Url(videoUrl: string, token: string): Promise<string> {
  const match = videoUrl.match(/vk\.com\/video(-?\d+)_(\d+)/);
  if (!match) {
    throw new Error('Invalid VK video URL format. Expected https://vk.com/video{owner_id}_{video_id}');
  }
  const ownerId = match[1];
  const videoId = match[2];
  const videosParam = `${ownerId}_${videoId}`;
  const apiUrl = `https://api.vk.com/method/video.get?videos=${videosParam}&access_token=${token}&v=${VK_API_VERSION}`;
  const response = await fetch(apiUrl);
  const data = await response.json();
  if (data.error) {
    throw new Error(`VK API error: ${data.error.error_msg}`);
  }
  const video = data.response.items[0];
  if (!video.files) {
    throw new Error('Video files not available. The video might be private or inaccessible.');
  }
  // Prefer highest quality MP4
  const files = video.files;
  return files.mp4_720 || files.mp4_480 || files.mp4_360 || files.mp4_240 || files.mp4_144;
}