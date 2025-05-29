export class StringHelpers {
  public static lstrip(x, characters) {
    var start = 0;
    while (characters.indexOf(x[start]) >= 0) {
      start += 1;
    }
    return x.substr(start);
  }

  public static strip(x) {
    return x.replace(/^\s+|\s+$/gm, "");
  }

  public static randomRangeInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public static asciiToBytes(str) {
    let out = [];
    for (let i = 0; i < str.length; i++) {
      out.push(str.charCodeAt(i));
    }
    return out;
  }
}
