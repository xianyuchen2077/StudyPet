(function(){
  function cat(pose='idle',size=''){
    const eyes=pose==='rest'?'<path d="m31 59 8 1m22 0 8-1" stroke="#666" stroke-width="1.8" stroke-linecap="round"/>':'<circle cx="35" cy="59" r="2.6" fill="#555"/><circle cx="65" cy="59" r="2.6" fill="#555"/>';
    const prop=pose==='study'?'<path d="M25 79q13-5 25 0 12-5 25 0v22q-12-5-25 0-12-5-25 0Z" fill="#e0e0d6" stroke="#777" stroke-width="1.3"/><path d="M50 79v22m-17-15h10m14 0h10m-34 6h10m14 0h10" stroke="#aaa" stroke-width="1.1"/>':pose==='review'?'<path d="M28 86h42v17H28Z" fill="#fff" stroke="#999" stroke-width="1.2"/><path d="m62 91 13-24 4 2-13 24-5 3Z" fill="#c9c9bd" stroke="#777" stroke-width="1.1"/><path d="M36 92h15m-15 5h12" stroke="#ccc"/>':pose==='error'?'<circle cx="83" cy="42" r="11" fill="#fffffd" stroke="#8d8d7d" stroke-width="1.2"/><path d="M83 36v7m0 4v1" stroke="#777" stroke-width="1.8" stroke-linecap="round"/>':'';
    const knownSize=['small','large',''].includes(size)?size:'';
    return `<svg class="pet-art ${knownSize}" viewBox="0 0 100 108" role="img" aria-label="StudyPet 学习小猫"><path d="M20 40 16 11 39 27 Q50 24 61 27 L84 11 80 40 Q90 52 84 80 Q82 96 50 97 Q18 96 16 80 Q10 53 20 40Z" fill="#f0f0ec" stroke="#777" stroke-width="1.5" stroke-linejoin="round"/><path d="m22 22 4 16 10-6m42-10-4 16-10-6" fill="#d9d9d4"/>${eyes}<path d="M45 68q5 8 10 0M28 94v9m44-9v9" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round"/><path d="M29 76h5m32 0h5" stroke="#b5b5af" stroke-width="2" stroke-linecap="round"/>${prop}</svg>`;
  }
  window.StudyPetArt=Object.freeze({cat});
})();
