const params = {
  name: 'Digital Azadi',
  bundle: 'com.tagmango.digitalazadi',
  domain: 'learn.digitalazadi.com',
  color: '#7a12d4',
  bgColor: '#ffffff',
  oneSignalId: '66e6eb97-fa48-4ac8-a8d5-bd4b1563075f',
};

const queryParam = Object.entries(params).reduce((acc, [key, value], index) => {
  if (index === 0) {
    return `${key}=${value}`;
  }
  if (key === 'color' || key === 'bgColor') {
    const encodedColor = encodeURIComponent(value);
    return `${acc}&${key}=${encodedColor}`;
  }
  return `${acc}&${key}=${value}`;
}, '');

const encodedUri = encodeURI(queryParam);
console.log(encodedUri);
