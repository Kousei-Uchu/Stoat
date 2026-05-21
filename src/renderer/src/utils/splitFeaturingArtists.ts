export const separateArtistsRegex = / and | [Ff](?:ea)?t\. |&|,|;|·| ?\| | ?\/ | ?\\ /gm;

const splitFeaturingArtists = (artist: string) => {
  const artists = artist.split(separateArtistsRegex);
  return artists;
};

export default splitFeaturingArtists;
